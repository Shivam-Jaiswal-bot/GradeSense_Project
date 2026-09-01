import {
  buildTermIndex,
  coverage,
  describeLink,
  mergeAssociations,
  polarAssociations,
  polarLinks,
  polarPairLabel,
  significantTerms,
  splitSentences,
} from '../text.js';
import type { PolarAssociations, PolarLinks } from '../text.js';
import type {
  GradeQuestionInput,
  LlmProvider,
  RawCriterion,
  RawIssue,
  RawQuestion,
} from './types.js';

/**
 * A deterministic stand-in for the LLM.
 *
 * It is NOT the grading intelligence of this project - the Anthropic provider
 * is. It exists so the whole system runs, and the whole test suite passes,
 * with no API key and no network. It grades by two rubric-agnostic signals:
 *
 *   1. lexical coverage - how much of the criterion's subject vocabulary (and
 *      the model answer's vocabulary for that criterion) the student uses,
 *      matched through OCR damage and misspelling;
 *   2. polarity inversion - the student using the opposite member of a polar
 *      pair from the model answer about the same subject ("in series" where
 *      the model says "in parallel", "surplus" where it says "shortage").
 *
 * Signal 2 is what catches confidently-wrong answers that score well on
 * similarity. Its confidence is reported honestly: this is a shallow reader and
 * it says so, which is what drives the human-review flag.
 */
export class MockProvider implements LlmProvider {
  readonly name = 'mock' as const;
  readonly model = 'lexical-rubric-matcher-v1';

  async gradeQuestion(input: GradeQuestionInput): Promise<RawQuestion> {
    const { question, studentAnswer } = input;
    const studentSentences = splitSentences(studentAnswer);
    const studentIndex = buildTermIndex(studentAnswer);
    const modelSentences = splitSentences(question.modelAnswer);

    const criteria: RawCriterion[] = [];
    const issues: RawIssue[] = [];

    const modelIndex = buildTermIndex(question.modelAnswer);

    const analyses = question.criteria.map((criterion) => {
      const scored = relevantModelSentences(modelSentences, criterion.description);
      const support = scored.slice(0, 3).map((entry) => entry.sentence);
      // Widen the vocabulary with the model answer's own words for this point.
      const terms = significantTerms(criterion.description);
      const expanded = new Set(terms);
      for (const sentence of support) {
        for (const term of significantTerms(sentence)) expanded.add(term);
      }
      // Only the best-matching sentences speak for this rubric point; a weaker
      // one is about a neighbouring point and would contradict them. Every
      // sentence at the top score counts, including ones past the support cut:
      // dropping one of them would hide a disagreement that should cancel.
      const best = scored.length > 0 ? scored[0]!.score : 0;
      const reference = mergeAssociations(
        scored.filter((entry) => entry.score >= best).map((entry) => entry.sentence),
      );
      const links = polarLinks([criterion.description, ...support].join('. '));

      // Can this rubric point be judged lexically at all? One about the quality
      // of an argument ("provides a coherent conclusion") shares almost no
      // vocabulary with the model answer, and word counting cannot assess it.
      // It does not get to claim a contradiction either.
      const assessable = coverage(terms, modelIndex) >= 0.25;

      return {
        criterion,
        terms,
        support,
        expanded,
        assessable,
        inversion: assessable
          ? findInversion(expanded, reference, studentSentences) ??
            findMispairing(links, studentSentences)
          : null,
      };
    });
    chargeInversionsOnce(analyses);

    for (const { criterion, terms, support, expanded, assessable, inversion } of analyses) {
      if (!assessable) {
        criteria.push({
          criterionId: criterion.id,
          awardedMarks: round(criterion.maxMarks / 2),
          status: 'partial',
          evidence: bestEvidence(expanded, studentSentences)
            ? [bestEvidence(expanded, studentSentences)!]
            : [],
          feedback:
            'The offline grader cannot judge this rubric point: it asks about the quality of the reasoning, not about content that can be matched by vocabulary. Provisional half mark pending review.',
          correction: '',
          confidence: 0.2,
        });
        issues.push({
          criterionId: criterion.id,
          type: 'missing_point',
          quote: '',
          correction: '',
          comment: `Needs a human examiner: ${criterion.description}`,
          confidence: 0.2,
        });
        continue;
      }

      const score = coverage(expanded, studentIndex);
      const evidence = bestEvidence(terms, studentSentences);

      if (inversion) {
        criteria.push({
          criterionId: criterion.id,
          awardedMarks: 0,
          status: 'incorrect',
          evidence: [inversion.studentSentence],
          feedback: `The answer ${inversion.detail}.`,
          correction: support[0] ?? criterion.description,
          confidence: 0.7,
        });
        issues.push({
          criterionId: criterion.id,
          type: 'wrong_reasoning',
          quote: inversion.studentSentence,
          correction: support[0] ?? criterion.description,
          comment: `This ${inversion.reversal}.`,
          confidence: 0.7,
        });
        continue;
      }

      if (score >= 0.5 && evidence) {
        criteria.push({
          criterionId: criterion.id,
          awardedMarks: criterion.maxMarks,
          status: 'correct',
          evidence: [evidence],
          feedback: 'The answer covers this rubric point.',
          correction: '',
          confidence: 0.62,
        });
      } else if (score >= 0.28 && evidence) {
        criteria.push({
          criterionId: criterion.id,
          awardedMarks: round(criterion.maxMarks / 2),
          status: 'partial',
          evidence: [evidence],
          feedback: 'The answer touches this rubric point but does not develop it.',
          correction: support[0] ?? '',
          confidence: 0.45,
        });
        issues.push({
          criterionId: criterion.id,
          type: 'missing_point',
          quote: evidence,
          correction: support[0] ?? criterion.description,
          comment: 'Develop this point further to earn the full mark.',
          confidence: 0.45,
        });
      } else {
        criteria.push({
          criterionId: criterion.id,
          awardedMarks: 0,
          status: 'missing',
          evidence: [],
          feedback:
            'No wording matching this rubric point was found. The offline grader matches vocabulary, so a point made in very different words can be missed here - this zero needs checking.',
          correction: support[0] ?? criterion.description,
          confidence: 0.3,
        });
        issues.push({
          criterionId: criterion.id,
          type: 'missing_point',
          quote: '',
          correction: support[0] ?? criterion.description,
          comment: `No evidence found for: ${criterion.description}`,
          confidence: 0.3,
        });
      }
    }

    const awarded = criteria.reduce((acc, c) => acc + c.awardedMarks, 0);
    return {
      questionId: question.id,
      criteria,
      issues,
      summary: `Lexical review scored ${awarded} of ${question.maxMarks}. ${
        issues.length
      } point(s) need attention. This is an offline heuristic reading and should be checked.`,
    };
  }
}

function round(value: number): number {
  return Math.round(value * 2) / 2;
}

function relevantModelSentences(
  sentences: string[],
  description: string,
): { sentence: string; score: number }[] {
  const terms = significantTerms(description);
  return sentences
    .map((sentence) => ({ sentence, score: coverage(terms, buildTermIndex(sentence)) }))
    .filter((entry) => entry.score > 0.15)
    .sort((a, b) => b.score - a.score);
}

function bestEvidence(terms: Set<string>, sentences: string[]): string | null {
  let best: { sentence: string; score: number } | null = null;
  for (const sentence of sentences) {
    const score = coverage(terms, buildTermIndex(sentence));
    if (!best || score > best.score) best = { sentence, score };
  }
  return best && best.score > 0.15 ? best.sentence : null;
}

interface Inversion {
  /** What the disagreement is about, for grouping and for the feedback text. */
  subject: string;
  studentSentence: string;
  /** "says the opposite ... about X" - reads after "The answer". */
  detail: string;
  /** "reverses ... for X" - reads after "This". */
  reversal: string;
}

interface Analysis {
  criterion: { id: string; description: string; maxMarks: number };
  terms: Set<string>;
  inversion: Inversion | null;
}

/**
 * One mistake, one criterion. The model answer explains the voltmeter in a
 * sentence that is relevant to several rubric points, so the same inversion is
 * detectable under all of them - and charging it three times would take three
 * marks for one error.
 *
 * The criterion that keeps it is the one whose own wording names the subject
 * ("voltmeter in parallel across the bulb"); between equals, the one whose
 * vocabulary the offending sentence matches best. The rest fall back to
 * ordinary coverage scoring.
 */
function chargeInversionsOnce(analyses: Analysis[]): void {
  const groups = new Map<string, Analysis[]>();
  for (const analysis of analyses) {
    if (!analysis.inversion) continue;
    const key = `${analysis.inversion.subject}#${analysis.inversion.studentSentence}`;
    groups.set(key, (groups.get(key) ?? []).concat(analysis));
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    let owner = group[0]!;
    let bestRank = rank(owner);
    for (const candidate of group.slice(1)) {
      const candidateRank = rank(candidate);
      if (candidateRank > bestRank) {
        owner = candidate;
        bestRank = candidateRank;
      }
    }
    for (const analysis of group) if (analysis !== owner) analysis.inversion = null;
  }
}

function rank(analysis: Analysis): number {
  const inversion = analysis.inversion!;
  const named = analysis.terms.has(inversion.subject) ? 1 : 0;
  return named + coverage(analysis.terms, buildTermIndex(inversion.studentSentence));
}

/**
 * Looks for the student and the model answer saying opposite things about the
 * same subject: "voltmeter ... series" against "voltmeter ... parallel".
 *
 * The subject must be part of this criterion's vocabulary, so an inversion
 * found while discussing something else cannot cost marks here.
 */
function findInversion(
  subjects: Set<string>,
  reference: PolarAssociations,
  studentSentences: string[],
): Inversion | null {
  if (reference.size === 0) return null;
  for (const studentSentence of studentSentences) {
    for (const [subject, studentPairs] of polarAssociations(studentSentence)) {
      if (!subjects.has(subject)) continue;
      const modelPairs = reference.get(subject);
      if (!modelPairs) continue;
      for (const [pair, studentSide] of studentPairs) {
        const modelSide = modelPairs.get(pair);
        if (modelSide !== undefined && modelSide !== studentSide) {
          return {
            subject,
            studentSentence,
            detail: `says the opposite of the marking scheme about "${subject}" (${polarPairLabel(
              pair,
            )})`,
            reversal: `reverses the ${polarPairLabel(pair)} relationship for "${subject}"`,
          };
        }
      }
    }
  }
  return null;
}

/**
 * Looks for the student combining two polar words the marking scheme combines
 * the other way round - "above ... shortage" where the scheme says "above ...
 * surplus". Every individual word is one the scheme itself uses, so only the
 * pairing gives the error away.
 */
function findMispairing(reference: PolarLinks, studentSentences: string[]): Inversion | null {
  if (reference.size === 0) return null;
  for (const studentSentence of studentSentences) {
    for (const [key, combinations] of polarLinks(studentSentence)) {
      const expected = reference.get(key);
      if (!expected) continue;
      for (const combination of combinations) {
        if (expected.has(combination)) continue;
        const correct = [...expected].map((c) => describeLink(key, c)).join(' and ');
        return {
          subject: describeLink(key, combination),
          studentSentence,
          detail: `pairs ${describeLink(key, combination)}; the marking scheme pairs ${correct}`,
          reversal: `pairs ${describeLink(key, combination)} - the marking scheme pairs ${correct}`,
        };
      }
    }
  }
  return null;
}

import { randomUUID } from 'node:crypto';
import type {
  CriterionResult,
  GradingRun,
  PageGeometry,
  ProviderMode,
  QuestionResult,
  Rubric,
  RubricQuestion,
  TextSpan,
} from '../../shared/types.js';
import { gradeQuestionResilient, type ProviderSet, type ResilientOptions } from './llm/index.js';
import { meaningfulLength, segmentAnswers, type AnswerBlock } from './segment.js';
import { validateQuestion } from './validate.js';

/**
 * Grades a whole paper: segment, grade each question independently, validate,
 * then aggregate. Question-level isolation means one failed or unanswerable
 * question degrades to a flagged zero instead of failing the paper.
 */

export interface GradePaperInput {
  rubric: Rubric;
  studentText: string;
  spans: TextSpan[];
  pages: PageGeometry[];
  studentDocumentId: string;
  questionPaperId?: string | null;
  modelAnswerId?: string | null;
  studentName?: string | null;
  providers: ProviderSet;
  options?: ResilientOptions;
}

/** Below this many characters of real writing, a question counts as unattempted. */
const BLANK_QUESTION_THRESHOLD = 25;
const BLANK_PAPER_THRESHOLD = 40;
const LOW_CONFIDENCE = 0.55;
const VERY_LOW_CRITERION_CONFIDENCE = 0.35;

function unattempted(question: RubricQuestion, reason: string): QuestionResult {
  const criteria: CriterionResult[] = question.criteria.map((criterion) => ({
    criterionId: criterion.id,
    description: criterion.description,
    maxMarks: criterion.maxMarks,
    awardedMarks: 0,
    status: 'missing',
    evidence: [],
    feedback: reason,
    correction: '',
    confidence: 0,
    adjustments: [],
  }));
  return {
    questionId: question.id,
    number: question.number,
    subject: question.subject,
    maxMarks: question.maxMarks,
    awardedMarks: 0,
    criteria,
    issues: [],
    summary: reason,
    confidence: 0,
  };
}

function providerMode(usedPrimary: boolean, usedFallback: boolean, primary: string): ProviderMode {
  if (usedPrimary && usedFallback) return 'anthropic->mock';
  if (usedFallback) return 'mock';
  return primary === 'anthropic' ? 'anthropic' : 'mock';
}

export async function gradePaper(input: GradePaperInput): Promise<GradingRun> {
  const startedAt = Date.now();
  const { rubric, studentText, spans, providers } = input;

  const adjustments: string[] = [];
  const reviewReasons: string[] = [];
  const questions: QuestionResult[] = [];

  let degraded = false;
  let usedPrimary = false;
  let usedFallback = false;

  const paperIsBlank = meaningfulLength(studentText) < BLANK_PAPER_THRESHOLD;
  if (paperIsBlank) {
    reviewReasons.push(
      'The answer paper appears to be blank. No marks were awarded and nothing was inferred.',
    );
  }

  const { blocks, warnings } = paperIsBlank
    ? { blocks: new Map<string, AnswerBlock>(), warnings: [] as string[] }
    : segmentAnswers(studentText, rubric.questions);
  adjustments.push(...warnings);
  if (warnings.length) {
    reviewReasons.push('The answers could not be matched to questions reliably.');
  }

  for (const question of rubric.questions) {
    if (paperIsBlank) {
      questions.push(unattempted(question, 'The answer paper is blank.'));
      continue;
    }

    const block = blocks.get(question.id);
    if (!block || meaningfulLength(block.text) < BLANK_QUESTION_THRESHOLD) {
      questions.push(unattempted(question, 'No answer was written for this question.'));
      reviewReasons.push(`Question ${question.number} appears unanswered.`);
      continue;
    }

    try {
      const outcome = await gradeQuestionResilient(
        { question, studentAnswer: block.text, rubric },
        providers,
        input.options,
      );
      if (outcome.degraded) {
        degraded = true;
        usedFallback = true;
        usedPrimary = true;
      } else if (outcome.provider.name === 'anthropic') {
        usedPrimary = true;
      } else {
        usedFallback = true;
      }
      adjustments.push(...outcome.notes);

      const validated = validateQuestion(outcome.raw, {
        question,
        block,
        documentText: studentText,
        spans,
      });
      questions.push(validated.result);
      adjustments.push(...validated.adjustments);
    } catch (error) {
      // Every retry and the fallback failed. Report the failure; do not guess.
      const message = error instanceof Error ? error.message : String(error);
      adjustments.push(`${question.id}: grading failed - ${message}`);
      reviewReasons.push(
        `Question ${question.number} could not be graded automatically and needs a human examiner.`,
      );
      questions.push(unattempted(question, `Grading failed: ${message}`));
      degraded = true;
    }
  }

  const awardedMarks = Math.min(
    Math.round(questions.reduce((acc, q) => acc + q.awardedMarks, 0) * 2) / 2,
    rubric.maxMarks,
  );

  const weight = questions.reduce((acc, q) => acc + q.maxMarks, 0) || 1;
  const confidence = questions.reduce((acc, q) => acc + q.confidence * q.maxMarks, 0) / weight;

  if (degraded) {
    reviewReasons.push(
      'At least one question was graded by the offline fallback after the model failed.',
    );
  }
  if (!paperIsBlank && confidence < LOW_CONFIDENCE) {
    reviewReasons.push(
      `Overall confidence is ${(confidence * 100).toFixed(0)}%, below the ${(
        LOW_CONFIDENCE * 100
      ).toFixed(0)}% threshold for an unreviewed result.`,
    );
  }
  const weak = questions
    .flatMap((q) => q.criteria)
    .filter((c) => c.confidence < VERY_LOW_CRITERION_CONFIDENCE);
  const awardedWeakly = weak.filter((c) => c.awardedMarks > 0);
  if (awardedWeakly.length) {
    reviewReasons.push(
      `${awardedWeakly.length} rubric point(s) were awarded marks with weak support: ${awardedWeakly
        .map((c) => c.criterionId)
        .join(', ')}.`,
    );
  }
  // A mark withheld on weak evidence costs the student, so it needs the same
  // scrutiny as a mark given on weak evidence.
  const withheldWeakly = weak.filter((c) => c.awardedMarks === 0);
  if (withheldWeakly.length) {
    reviewReasons.push(
      `${withheldWeakly.length} rubric point(s) were scored zero on weak evidence: ${withheldWeakly
        .map((c) => c.criterionId)
        .join(', ')}.`,
    );
  }

  return {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    studentDocumentId: input.studentDocumentId,
    studentName: input.studentName ?? null,
    questionPaperId: input.questionPaperId ?? null,
    modelAnswerId: input.modelAnswerId ?? null,
    maxMarks: rubric.maxMarks,
    awardedMarks,
    questions,
    confidence,
    needsHumanReview: reviewReasons.length > 0,
    reviewReasons,
    provider: providerMode(usedPrimary, usedFallback, providers.primary.name),
    model: usedFallback && degraded ? `${providers.primary.model} -> fallback` : providers.primary.model,
    adjustments,
    degraded,
    durationMs: Date.now() - startedAt,
  };
}

import type {
  CriterionResult,
  CriterionStatus,
  Evidence,
  GradingIssue,
  QuestionResult,
  RubricQuestion,
  TextSpan,
} from '../../shared/types.js';
import { locate, rectsForRange } from './anchor.js';
import type { AnswerBlock } from './segment.js';
import type { RawQuestion } from './llm/types.js';

/**
 * Turns raw model output into a result that is safe to show a teacher.
 *
 * Nothing the model says about totals is trusted. Marks are clamped to the
 * rubric, totals are recomputed from the clamped marks, and every quote is
 * checked against the actual paper before it can be shown as evidence or drawn
 * as an annotation. Every correction made here is recorded, because a silent
 * repair is indistinguishable from a correct answer.
 */

export interface ValidateContext {
  question: RubricQuestion;
  block: AnswerBlock;
  /** Full paper text; offsets in evidence are relative to this. */
  documentText: string;
  spans: TextSpan[];
}

export interface ValidationOutcome {
  result: QuestionResult;
  adjustments: string[];
}

/** Marks are recorded in half-mark steps; anything finer is examiner noise. */
function roundMarks(value: number): number {
  return Math.round(value * 2) / 2;
}

function clampMarks(
  raw: unknown,
  max: number,
  criterionId: string,
  adjustments: string[],
): number {
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : Number.NaN;
  if (Number.isNaN(value)) {
    adjustments.push(`${criterionId}: marks were not a number, recorded as 0`);
    return 0;
  }
  if (value > max) {
    adjustments.push(`${criterionId}: ${value} exceeded the ${max} available, clamped to ${max}`);
    return max;
  }
  if (value < 0) {
    adjustments.push(`${criterionId}: negative marks (${value}) raised to 0`);
    return 0;
  }
  const rounded = roundMarks(value);
  if (rounded !== value) {
    adjustments.push(`${criterionId}: ${value} rounded to the nearest half mark (${rounded})`);
  }
  return rounded;
}

function clampConfidence(raw: unknown): number {
  const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : 0.4;
  return Math.min(1, Math.max(0, value));
}

/** Keeps the reported status consistent with the marks actually awarded. */
function reconcileStatus(
  status: CriterionStatus,
  awarded: number,
  max: number,
  hasEvidence: boolean,
  criterionId: string,
  adjustments: string[],
): CriterionStatus {
  let expected: CriterionStatus;
  if (awarded >= max) expected = 'correct';
  else if (awarded > 0) expected = 'partial';
  else expected = hasEvidence ? 'incorrect' : 'missing';

  // "incorrect" and "missing" both mean zero marks, so accept whichever the
  // grader chose; only correct genuinely contradictory pairings.
  const equivalent =
    (expected === 'incorrect' && status === 'missing') ||
    (expected === 'missing' && status === 'incorrect');
  if (status !== expected && !equivalent) {
    adjustments.push(
      `${criterionId}: status "${status}" did not match ${awarded}/${max} marks, recorded as "${expected}"`,
    );
    return expected;
  }
  return status;
}

/**
 * Verifies each quote against the paper. Unverifiable quotes are dropped:
 * feedback must be supported by what the student actually wrote.
 */
function verifyEvidence(
  quotes: string[],
  context: ValidateContext,
  criterionId: string,
  adjustments: string[],
): Evidence[] {
  const evidence: Evidence[] = [];
  for (const quote of quotes) {
    const text = quote.trim();
    if (!text) continue;
    const located = locate(text, context.documentText);
    if (!located) {
      adjustments.push(
        `${criterionId}: dropped a quote that does not appear in the answer ("${truncate(text)}")`,
      );
      continue;
    }
    const rects = rectsForRange(located, context.spans);
    evidence.push({
      quote: context.documentText.slice(located.start, located.end),
      offset: located.start,
      page: rects[0]?.page,
      rects,
    });
  }
  return evidence;
}

function truncate(text: string, length = 60): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}...`;
}

export function validateQuestion(
  raw: RawQuestion,
  context: ValidateContext,
): ValidationOutcome {
  const { question } = context;
  const adjustments: string[] = [];
  const byId = new Map(raw.criteria.map((c) => [c.criterionId, c]));

  for (const returned of raw.criteria) {
    if (!question.criteria.some((c) => c.id === returned.criterionId)) {
      adjustments.push(
        `${question.id}: ignored "${returned.criterionId}", which is not in the rubric`,
      );
    }
  }

  const criteria: CriterionResult[] = question.criteria.map((criterion) => {
    const returned = byId.get(criterion.id);
    if (!returned) {
      adjustments.push(
        `${criterion.id}: no result returned, recorded as 0 and flagged for review`,
      );
      return {
        criterionId: criterion.id,
        description: criterion.description,
        maxMarks: criterion.maxMarks,
        awardedMarks: 0,
        status: 'missing',
        evidence: [],
        feedback: 'The grader did not return a result for this rubric point.',
        correction: '',
        confidence: 0,
        adjustments: ['no result returned by the grader'],
      };
    }

    const before = adjustments.length;
    const awarded = clampMarks(returned.awardedMarks, criterion.maxMarks, criterion.id, adjustments);
    const evidence = verifyEvidence(returned.evidence, context, criterion.id, adjustments);
    const status = reconcileStatus(
      returned.status,
      awarded,
      criterion.maxMarks,
      evidence.length > 0,
      criterion.id,
      adjustments,
    );

    let confidence = clampConfidence(returned.confidence);
    // Marks awarded with no verifiable evidence are not defensible to a teacher.
    if (awarded > 0 && evidence.length === 0) {
      adjustments.push(
        `${criterion.id}: ${awarded} mark(s) awarded with no quote we could verify; confidence reduced`,
      );
      confidence = Math.min(confidence, 0.35);
    }

    const feedback =
      returned.feedback.trim() ||
      (status === 'correct'
        ? 'This rubric point is met.'
        : `Not fully met: ${criterion.description}`);

    return {
      criterionId: criterion.id,
      description: criterion.description,
      maxMarks: criterion.maxMarks,
      awardedMarks: awarded,
      status,
      evidence,
      feedback,
      correction: returned.correction.trim(),
      confidence,
      adjustments: adjustments.slice(before),
    };
  });

  const issues = buildIssues(raw, criteria, context, adjustments);

  // The total is derived, never taken from the model.
  const awardedMarks = roundMarks(criteria.reduce((acc, c) => acc + c.awardedMarks, 0));
  if (awardedMarks > question.maxMarks) {
    // Unreachable given per-criterion clamping, but a rubric can be malformed.
    adjustments.push(
      `${question.id}: total ${awardedMarks} exceeded the ${question.maxMarks} available`,
    );
  }

  const weight = criteria.reduce((acc, c) => acc + c.maxMarks, 0) || 1;
  const confidence =
    criteria.reduce((acc, c) => acc + c.confidence * c.maxMarks, 0) / weight;

  return {
    result: {
      questionId: question.id,
      number: question.number,
      subject: question.subject,
      maxMarks: question.maxMarks,
      awardedMarks: Math.min(awardedMarks, question.maxMarks),
      criteria,
      issues,
      summary: raw.summary.trim() || `Scored ${awardedMarks} of ${question.maxMarks}.`,
      confidence,
      answerRange: { start: context.block.start, end: context.block.end },
    },
    adjustments,
  };
}

/**
 * Issues are what get drawn on the paper. Each one is located, given a share of
 * the marks its criterion lost, and de-duplicated against the others.
 */
function buildIssues(
  raw: RawQuestion,
  criteria: CriterionResult[],
  context: ValidateContext,
  adjustments: string[],
): GradingIssue[] {
  const deficits = new Map<string, number>();
  for (const criterion of criteria) {
    deficits.set(criterion.criterionId, criterion.maxMarks - criterion.awardedMarks);
  }

  const valid = new Set(criteria.map((c) => c.criterionId));
  const issues: GradingIssue[] = [];
  const seen = new Set<string>();

  for (const [index, item] of raw.issues.entries()) {
    const criterionId =
      item.criterionId && valid.has(item.criterionId) ? item.criterionId : null;
    if (item.criterionId && !criterionId) {
      adjustments.push(
        `${context.question.id}: issue referenced unknown criterion "${item.criterionId}"`,
      );
    }

    const quote = item.quote.trim();
    let located = quote ? locate(quote, context.documentText) : null;
    if (quote && !located) {
      adjustments.push(
        `${context.question.id}: could not find the text for an issue ("${truncate(quote)}"); it will be placed against the question instead`,
      );
    }
    // Keep the located text verbatim so the annotation and the paper agree.
    const resolvedQuote = located
      ? context.documentText.slice(located.start, located.end)
      : '';

    const comment = item.comment.trim() || item.correction.trim();
    if (!comment && !resolvedQuote) continue;

    const key = `${criterionId ?? '-'}|${resolvedQuote}|${comment}`;
    if (seen.has(key)) continue;
    seen.add(key);

    issues.push({
      id: `${context.question.id}.i${index + 1}`,
      questionId: context.question.id,
      criterionId,
      type: item.type,
      quote: resolvedQuote,
      correction: item.correction.trim(),
      comment: comment || 'Review this point.',
      marksLost: 0,
      confidence: clampConfidence(item.confidence),
    });
    located = null;
  }

  // Split each criterion's lost marks across the issues that explain it, so the
  // numbers written on the paper add up to the marks actually deducted.
  const byCriterion = new Map<string, GradingIssue[]>();
  for (const issue of issues) {
    if (!issue.criterionId) continue;
    byCriterion.set(issue.criterionId, [...(byCriterion.get(issue.criterionId) ?? []), issue]);
  }
  for (const [criterionId, group] of byCriterion) {
    const deficit = deficits.get(criterionId) ?? 0;
    if (deficit <= 0) continue;
    const share = roundMarks(deficit / group.length);
    group.forEach((issue, i) => {
      // Give any rounding remainder to the first issue.
      issue.marksLost = i === 0 ? roundMarks(deficit - share * (group.length - 1)) : share;
    });
  }

  return issues;
}

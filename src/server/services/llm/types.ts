import { z } from 'zod';
import type { Rubric, RubricQuestion } from '../../../shared/types.js';

/**
 * The shape we ask the model for. Everything here is treated as untrusted:
 * validate.ts re-derives all totals and verifies every quote before any of it
 * reaches a score. The schema exists to reject noise early, not to trust it.
 */
export const RawCriterionSchema = z.object({
  criterionId: z.string(),
  awardedMarks: z.number(),
  status: z.enum(['correct', 'partial', 'missing', 'incorrect']),
  evidence: z.array(z.string()).default([]),
  feedback: z.string().default(''),
  correction: z.string().default(''),
  confidence: z.number().default(0.5),
});

export const RawIssueSchema = z.object({
  criterionId: z.string().nullable().default(null),
  type: z
    .enum(['missing_point', 'wrong_reasoning', 'factual_error', 'spelling', 'grammar', 'layout'])
    .default('wrong_reasoning'),
  quote: z.string().default(''),
  correction: z.string().default(''),
  comment: z.string().default(''),
  confidence: z.number().default(0.5),
});

export const RawQuestionSchema = z.object({
  questionId: z.string(),
  criteria: z.array(RawCriterionSchema).default([]),
  issues: z.array(RawIssueSchema).default([]),
  summary: z.string().default(''),
});

export const RawGradingSchema = z.object({
  questions: z.array(RawQuestionSchema).default([]),
});

export type RawGrading = z.infer<typeof RawGradingSchema>;
export type RawQuestion = z.infer<typeof RawQuestionSchema>;
export type RawCriterion = z.infer<typeof RawCriterionSchema>;
export type RawIssue = z.infer<typeof RawIssueSchema>;

export interface GradeQuestionInput {
  question: RubricQuestion;
  /** The student's text for this question only. */
  studentAnswer: string;
  rubric: Rubric;
}

export interface LlmProvider {
  readonly name: 'anthropic' | 'mock';
  readonly model: string;
  /** Grades one question. Throws LlmError on failure; the caller decides. */
  gradeQuestion(input: GradeQuestionInput, signal?: AbortSignal): Promise<RawQuestion>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly kind: 'network' | 'auth' | 'rate_limit' | 'malformed' | 'timeout' | 'unknown',
    readonly retryable: boolean,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'LlmError';
  }
}

/**
 * The eight scenarios the tool has to survive: a fully correct answer, a
 * partially correct one, a wrong one, a blank one, an OCR-damaged one, a model
 * that returns malformed output, a model that fails outright, and a model that
 * awards more marks than exist.
 */

import { describe, expect, it } from 'vitest';
import { gradePaper } from '../src/server/services/grader.js';
import { MockProvider } from '../src/server/services/llm/mock.js';
import { LlmError, type LlmProvider, type RawQuestion } from '../src/server/services/llm/types.js';
import type { GradingRun } from '../src/shared/types.js';
import { answer, loadRubric, type AnswerVariant } from './helpers.js';

const FAST = { retries: 1, retryDelayMs: 0, timeoutMs: 5_000 };

async function grade(
  variant: AnswerVariant,
  providers?: { primary: LlmProvider; fallback: LlmProvider | null },
): Promise<GradingRun> {
  const [{ rubric }, paper] = await Promise.all([loadRubric(), answer(variant)]);
  return gradePaper({
    rubric,
    studentText: paper.text,
    spans: paper.spans,
    pages: paper.pages,
    studentDocumentId: `doc-${variant}`,
    providers: providers ?? { primary: new MockProvider(), fallback: null },
    options: FAST,
  });
}

/** Invariants that must hold for every run, however the model behaved. */
function expectSoundArithmetic(run: GradingRun) {
  expect(run.awardedMarks).toBeLessThanOrEqual(run.maxMarks);
  expect(run.awardedMarks).toBeGreaterThanOrEqual(0);

  const questionTotal = run.questions.reduce((sum, q) => sum + q.awardedMarks, 0);
  expect(run.awardedMarks).toBeCloseTo(questionTotal, 5);

  for (const question of run.questions) {
    const criterionTotal = question.criteria.reduce((sum, c) => sum + c.awardedMarks, 0);
    expect(question.awardedMarks).toBeCloseTo(criterionTotal, 5);
    expect(question.awardedMarks).toBeLessThanOrEqual(question.maxMarks);
    for (const criterion of question.criteria) {
      expect(criterion.awardedMarks).toBeLessThanOrEqual(criterion.maxMarks);
      expect(criterion.awardedMarks).toBeGreaterThanOrEqual(0);
      expect(criterion.confidence).toBeGreaterThanOrEqual(0);
      expect(criterion.confidence).toBeLessThanOrEqual(1);
    }
  }
}

/** Every quote handed back must really be in the paper. */
function expectEvidenceIsReal(run: GradingRun, paperText: string) {
  const haystack = paperText.replace(/\s+/g, ' ').toLowerCase();
  for (const question of run.questions) {
    for (const criterion of question.criteria) {
      for (const evidence of criterion.evidence) {
        expect(haystack).toContain(evidence.quote.replace(/\s+/g, ' ').toLowerCase());
      }
    }
  }
}

describe('grading scenarios', () => {
  it('a fully correct answer scores well and reports no wrong reasoning', async () => {
    const run = await grade('correct');
    const paper = await answer('correct');

    expectSoundArithmetic(run);
    expectEvidenceIsReal(run, paper.text);
    expect(run.awardedMarks).toBeGreaterThanOrEqual(11);

    const wrong = run.questions.flatMap((q) =>
      q.criteria.filter((c) => c.status === 'incorrect'),
    );
    expect(wrong).toHaveLength(0);
  });

  it('a partially correct answer loses marks exactly where the errors were planted', async () => {
    const run = await grade('planted');
    const paper = await answer('planted');

    expectSoundArithmetic(run);
    expectEvidenceIsReal(run, paper.text);
    expect(run.awardedMarks).toBeGreaterThan(3);
    expect(run.awardedMarks).toBeLessThan(11);

    // The planted substantive errors: voltmeter in series, Ohm's law inverted,
    // axes swapped, shortage/surplus swapped, and the wrong equilibrium shift.
    const wrong = new Set(
      run.questions.flatMap((q) =>
        q.criteria.filter((c) => c.status === 'incorrect').map((c) => c.criterionId),
      ),
    );
    for (const id of ['q1.c2', 'q1.c4', 'q3.c1', 'q3.c3', 'q3.c5']) {
      expect(wrong, `expected ${id} to be marked incorrect`).toContain(id);
    }
  });

  it('an answer that is wrong throughout scores low and is flagged', async () => {
    const run = await grade('incorrect');
    expectSoundArithmetic(run);
    expect(run.awardedMarks).toBeLessThan(5);
    expect(run.needsHumanReview).toBe(true);
  });

  it('a blank paper scores zero, invents nothing and asks for a human', async () => {
    const run = await grade('blank');
    expectSoundArithmetic(run);
    expect(run.awardedMarks).toBe(0);
    expect(run.needsHumanReview).toBe(true);
    expect(run.reviewReasons.join(' ')).toMatch(/blank/i);

    for (const question of run.questions) {
      for (const criterion of question.criteria) {
        expect(criterion.evidence).toHaveLength(0);
        expect(criterion.awardedMarks).toBe(0);
      }
    }
  });

  it('OCR-style spelling damage does not cost the student marks', async () => {
    const clean = await grade('correct');
    const damaged = await grade('ocr');
    expectSoundArithmetic(damaged);
    expect(damaged.awardedMarks).toBe(clean.awardedMarks);
  });

  it('malformed model output is repaired or refused, never trusted', async () => {
    const provider: LlmProvider = {
      name: 'anthropic',
      model: 'test-malformed',
      async gradeQuestion(input) {
        // Well-formed JSON, nonsense content: unknown criterion ids, a quote
        // that is not in the paper, a status that contradicts the marks.
        return {
          questionId: input.question.id,
          criteria: [
            {
              criterionId: 'not-a-real-criterion',
              awardedMarks: 1,
              status: 'correct',
              evidence: ['the student never wrote this sentence at all'],
              feedback: 'invented',
              correction: '',
              confidence: 0.99,
            },
          ],
          issues: [],
          summary: 'invented',
        } as RawQuestion;
      },
    };

    const run = await grade('planted', { primary: provider, fallback: null });
    const paper = await answer('planted');

    expectSoundArithmetic(run);
    expectEvidenceIsReal(run, paper.text);
    expect(run.adjustments.length).toBeGreaterThan(0);
    // Nothing may be awarded on the strength of a fabricated quote.
    for (const question of run.questions) {
      for (const criterion of question.criteria) {
        if (criterion.awardedMarks > 0 && criterion.evidence.length === 0) {
          expect(criterion.confidence).toBeLessThanOrEqual(0.35);
        }
      }
    }
  });

  it('a model that keeps failing falls back and says so', async () => {
    let attempts = 0;
    const failing: LlmProvider = {
      name: 'anthropic',
      model: 'test-broken',
      async gradeQuestion() {
        attempts++;
        throw new LlmError('upstream is down', 'network', true);
      },
    };

    const run = await grade('planted', { primary: failing, fallback: new MockProvider() });
    expectSoundArithmetic(run);
    expect(attempts).toBeGreaterThan(1);
    expect(run.degraded).toBe(true);
    expect(run.provider).toBe('anthropic->mock');
    expect(run.needsHumanReview).toBe(true);
    expect(run.reviewReasons.join(' ')).toMatch(/fallback/i);
    // The fallback still produced a real grade rather than an empty one.
    expect(run.awardedMarks).toBeGreaterThan(0);
  });

  it('a model that fails with no fallback reports the failure instead of guessing', async () => {
    const failing: LlmProvider = {
      name: 'anthropic',
      model: 'test-broken',
      async gradeQuestion() {
        throw new LlmError('bad key', 'auth', false);
      },
    };

    const run = await grade('planted', { primary: failing, fallback: null });
    expectSoundArithmetic(run);
    expect(run.awardedMarks).toBe(0);
    expect(run.needsHumanReview).toBe(true);
    expect(run.adjustments.join(' ')).toMatch(/grading failed/i);
  });

  it('marks above the maximum are clamped and the correction is recorded', async () => {
    const greedy: LlmProvider = {
      name: 'anthropic',
      model: 'test-greedy',
      async gradeQuestion(input) {
        return {
          questionId: input.question.id,
          criteria: input.question.criteria.map((criterion) => ({
            criterionId: criterion.id,
            awardedMarks: 99,
            status: 'correct' as const,
            evidence: [],
            feedback: 'full marks',
            correction: '',
            confidence: 1,
          })),
          issues: [],
          summary: 'full marks everywhere',
        } as RawQuestion;
      },
    };

    const run = await grade('planted', { primary: greedy, fallback: null });
    expectSoundArithmetic(run);
    expect(run.awardedMarks).toBe(run.maxMarks);
    expect(run.adjustments.join(' ')).toMatch(/above the maximum|clamp/i);
  });
});

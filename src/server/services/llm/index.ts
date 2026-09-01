import { AnthropicProvider } from './anthropic.js';
import { MockProvider } from './mock.js';
import { LlmError, type GradeQuestionInput, type LlmProvider, type RawQuestion } from './types.js';

export { LlmError } from './types.js';
export type { LlmProvider, GradeQuestionInput, RawQuestion } from './types.js';
export { MockProvider } from './mock.js';
export { AnthropicProvider } from './anthropic.js';

export interface ProviderSet {
  primary: LlmProvider;
  /** Used when the primary fails outright. Null when the primary is the mock. */
  fallback: LlmProvider | null;
}

/**
 * Chooses the grading provider from the environment. With a key present we use
 * the real model and keep the offline grader as a safety net; without one we
 * run entirely offline so the tool still works.
 */
export function createProviders(env: NodeJS.ProcessEnv = process.env): ProviderSet {
  const forced = env.GRADESENSE_PROVIDER?.trim().toLowerCase();
  const key = env.ANTHROPIC_API_KEY?.trim();

  if (forced === 'mock' || (!key && forced !== 'anthropic')) {
    return { primary: new MockProvider(), fallback: null };
  }
  if (!key) {
    throw new Error(
      'GRADESENSE_PROVIDER=anthropic was set but ANTHROPIC_API_KEY is missing. Set the key or use GRADESENSE_PROVIDER=mock.',
    );
  }
  return { primary: new AnthropicProvider(key), fallback: new MockProvider() };
}

export interface ResilientOptions {
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

export interface ResilientResult {
  raw: RawQuestion;
  provider: LlmProvider;
  /** True when the primary provider failed and the fallback produced this. */
  degraded: boolean;
  notes: string[];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Grades one question with retries and a fallback.
 *
 * Retries cover the transient failures (rate limits, 5xx, a truncated JSON
 * response). An auth failure is not retried - the key will not fix itself.
 * When everything fails we fall back to the offline grader and mark the result
 * degraded rather than returning marks that look normal.
 */
export async function gradeQuestionResilient(
  input: GradeQuestionInput,
  providers: ProviderSet,
  options: ResilientOptions = {},
): Promise<ResilientResult> {
  const retries = options.retries ?? 2;
  const delay = options.retryDelayMs ?? 400;
  const timeoutMs = options.timeoutMs ?? 60_000;
  const notes: string[] = [];

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const raw = await providers.primary.gradeQuestion(input, controller.signal);
      return { raw, provider: providers.primary, degraded: false, notes };
    } catch (error) {
      const llmError =
        error instanceof LlmError
          ? error
          : new LlmError(String((error as Error)?.message ?? error), 'unknown', true, {
              cause: error,
            });
      notes.push(
        `${input.question.id}: attempt ${attempt + 1} failed (${llmError.kind}) - ${llmError.message}`,
      );
      const canRetry = llmError.retryable && attempt < retries;
      if (!canRetry) break;
      // Exponential backoff; keeps a rate limit from turning into a stampede.
      await sleep(delay * 2 ** attempt);
    } finally {
      clearTimeout(timer);
    }
  }

  if (!providers.fallback) {
    throw new LlmError(
      `grading failed for ${input.question.id} and no fallback grader is configured`,
      'unknown',
      false,
    );
  }

  notes.push(`${input.question.id}: fell back to the offline grader`);
  const raw = await providers.fallback.gradeQuestion(input);
  return { raw, provider: providers.fallback, degraded: true, notes };
}

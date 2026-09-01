import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompt.js';
import { parseQuestionResponse } from './json.js';
import { LlmError, type GradeQuestionInput, type LlmProvider, type RawQuestion } from './types.js';

const DEFAULT_MODEL = 'claude-sonnet-5';

function classify(error: unknown): LlmError {
  if (error instanceof LlmError) return error;
  const status = (error as { status?: number } | null)?.status;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 401 || status === 403) {
    return new LlmError(`Anthropic rejected the API key (${status})`, 'auth', false, {
      cause: error,
    });
  }
  if (status === 429) {
    return new LlmError('Anthropic rate limit reached', 'rate_limit', true, { cause: error });
  }
  if (status !== undefined && status >= 500) {
    return new LlmError(`Anthropic server error (${status})`, 'network', true, { cause: error });
  }
  if (/abort|timeout/i.test(message)) {
    return new LlmError('the grading request timed out', 'timeout', true, { cause: error });
  }
  return new LlmError(`Anthropic request failed: ${message}`, 'unknown', true, { cause: error });
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;
  private client: Anthropic;

  constructor(apiKey: string, model = process.env.GRADESENSE_MODEL || DEFAULT_MODEL) {
    this.model = model;
    this.client = new Anthropic({ apiKey, maxRetries: 0 });
  }

  async gradeQuestion(input: GradeQuestionInput, signal?: AbortSignal): Promise<RawQuestion> {
    let response;
    try {
      response = await this.client.messages.create(
        {
          model: this.model,
          max_tokens: 3000,
          // Grading should be reproducible run to run, so we pin temperature low.
          temperature: 0,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserPrompt(input) }],
        },
        { signal },
      );
    } catch (error) {
      throw classify(error);
    }

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    if (!text.trim()) {
      throw new LlmError(`empty response for ${input.question.id}`, 'malformed', true);
    }
    if (response.stop_reason === 'max_tokens') {
      // Truncated output is the common source of malformed JSON; say so plainly.
      throw new LlmError(
        `response for ${input.question.id} was cut off at the token limit`,
        'malformed',
        true,
      );
    }
    return parseQuestionResponse(text, input.question.id);
  }
}

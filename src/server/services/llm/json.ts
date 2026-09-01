import { RawQuestionSchema, LlmError, type RawQuestion } from './types.js';

/**
 * Models wrap JSON in prose or fences, truncate it, or trail a comma. We make
 * a bounded repair attempt before giving up - one cheap local fix beats a
 * second API call, and giving up cleanly beats guessing at marks.
 */
export function extractJsonObject(raw: string): string | null {
  const text = raw.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced?.[1]?.trim() ?? text;

  const start = candidate.indexOf('{');
  if (start === -1) return null;

  // Walk the string tracking depth so we stop at the matching brace rather
  // than the last one in the file, which may belong to trailing commentary.
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i]!;
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      escaped = true;
      continue;
    }
    if (ch === '"') inString = !inString;
    if (inString) continue;
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  // Unbalanced: the response was cut off mid-object.
  return null;
}

function stripTrailingCommas(json: string): string {
  return json.replace(/,\s*([}\]])/g, '$1');
}

export function parseQuestionResponse(raw: string, questionId: string): RawQuestion {
  const json = extractJsonObject(raw);
  if (!json) {
    throw new LlmError(
      `no JSON object found in the response for ${questionId}`,
      'malformed',
      true,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    try {
      parsed = JSON.parse(stripTrailingCommas(json));
    } catch (error) {
      throw new LlmError(`unparseable JSON for ${questionId}`, 'malformed', true, {
        cause: error,
      });
    }
  }

  const result = RawQuestionSchema.safeParse(parsed);
  if (!result.success) {
    throw new LlmError(
      `response for ${questionId} did not match the expected shape: ${result.error.issues
        .slice(0, 3)
        .map((i) => `${i.path.join('.')} ${i.message}`)
        .join('; ')}`,
      'malformed',
      true,
    );
  }
  return { ...result.data, questionId };
}

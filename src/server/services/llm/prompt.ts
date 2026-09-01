import type { GradeQuestionInput } from './types.js';

/**
 * One question per call. Grading each question in isolation keeps the context
 * small, stops one bad answer from colouring another, and means a single
 * failed question degrades to a flagged question instead of a failed paper.
 */
export const SYSTEM_PROMPT = `You are an experienced examiner marking a school examination answer.

You mark strictly against the supplied rubric. Your job is to judge the quality of the student's reasoning, NOT its similarity to the model answer. A student who reaches a different conclusion, uses different wording, or lays the work out differently must receive full marks when the reasoning and the facts are sound.

Rules you must follow:
1. Award marks only from the rubric. Never exceed a criterion's maximum, never award a negative mark. Half marks are allowed.
2. Every "evidence" string must be copied VERBATIM from the student answer, character for character. Never paraphrase, never invent, never quote the model answer. If you cannot find supporting text, return an empty evidence list and use status "missing".
3. Judge what the student wrote, including labels inside diagrams, which appear in the text as ordinary lines.
4. Report a substantive error (a wrong fact or wrong reasoning) separately from a surface error (spelling, grammar, layout). Surface errors must not by themselves cost rubric marks unless the rubric asks for communication quality.
5. "confidence" is your own certainty for that criterion, from 0 to 1. Use a low value when the answer is ambiguous, unreadable, or you had to guess. Being uncertain is correct and useful; pretending to be certain is not.
6. Output JSON only. No prose, no markdown fence.`;

export function buildUserPrompt(input: GradeQuestionInput): string {
  const { question, studentAnswer } = input;
  const criteria = question.criteria
    .map((c) => `- id "${c.id}" (max ${c.maxMarks} marks): ${c.description}`)
    .join('\n');

  return [
    `QUESTION ${question.number} (${question.subject}) - ${question.maxMarks} marks`,
    question.prompt ? `\n${question.prompt}` : '',
    `\n\nMODEL ANSWER (a reference, not a target to match)\n${question.modelAnswer}`,
    question.guidance ? `\n\nEXAMINER GUIDANCE\n${question.guidance}` : '',
    `\n\nRUBRIC\n${criteria}`,
    `\n\nSTUDENT ANSWER (verbatim, including diagram labels)\n"""\n${studentAnswer}\n"""`,
    `\n\nReturn JSON exactly in this shape:
{
  "questionId": "${question.id}",
  "criteria": [
    {
      "criterionId": "<one of the ids above>",
      "awardedMarks": <number, 0 to the criterion maximum>,
      "status": "correct" | "partial" | "missing" | "incorrect",
      "evidence": ["<verbatim quote from the student answer>"],
      "feedback": "<what the student did, in one or two sentences>",
      "correction": "<what the answer should have said; empty when fully correct>",
      "confidence": <0 to 1>
    }
  ],
  "issues": [
    {
      "criterionId": "<criterion id or null>",
      "type": "missing_point" | "wrong_reasoning" | "factual_error" | "spelling" | "grammar" | "layout",
      "quote": "<verbatim text that is wrong; empty string for a missing point>",
      "correction": "<the corrected version>",
      "comment": "<short note for the student>",
      "confidence": <0 to 1>
    }
  ],
  "summary": "<two sentences on the answer overall>"
}

Include one entry in "criteria" for every rubric id, in order. Put one entry in "issues" for each distinct mistake you want marked on the paper.`,
  ].join('');
}

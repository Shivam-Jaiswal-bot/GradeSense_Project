import type { Rubric, RubricCriterion, RubricQuestion } from '../../shared/types.js';

/**
 * Parses the model-answer / marking-rubric PDF into a structured rubric.
 *
 * The document is a normal exam marking scheme, so we parse it structurally
 * rather than asking an LLM: the rubric decides the maximum marks, and a
 * hallucinated rubric would silently corrupt every score downstream.
 */

export interface RubricParseResult {
  rubric: Rubric;
  warnings: string[];
}

const QUESTION_HEADING = /^Q(?:uestion)?\s*(\d+)\s*[—–-]\s*(.+?)\s*$/i;
const MODEL_ANSWER_HEADING = /^Model Answer\s*[—–-]\s*(\d+(?:\.\d+)?)\s*marks?/i;
const RUBRIC_HEADING = /^Marking rubric/i;
const GUIDANCE_HEADING = /^Important grading guidance/i;
const CRITERION_HEADER = /^Criterion\s+Marks$/i;
const TOTAL_ROW = /^Total\s+(\d+(?:\.\d+)?)$/i;
const BARE_NUMBER = /^(\d+(?:\.\d+)?)$/;
const TRAILING_MARKS = /^(.*\S)\s+(\d+(?:\.\d+)?)$/;

interface Block {
  number: number;
  subject: string;
  lines: string[];
}

function splitIntoQuestions(lines: string[]): Block[] {
  const blocks: Block[] = [];
  for (const line of lines) {
    const heading = QUESTION_HEADING.exec(line);
    // A heading only counts if it is short - "Q3 — Economics", not a sentence
    // that happens to start that way.
    if (heading && line.length < 60) {
      blocks.push({
        number: Number(heading[1]),
        subject: (heading[2] ?? '').trim(),
        lines: [],
      });
      continue;
    }
    blocks[blocks.length - 1]?.lines.push(line);
  }
  return blocks;
}

/**
 * Reads the criterion/marks table. Table cells wrap across several extracted
 * lines and the marks column can land on a line of its own between them, so we
 * buffer text and attach it to the most recently seen marks value.
 */
function parseCriteriaTable(
  lines: string[],
  questionId: string,
  warnings: string[],
): { criteria: RubricCriterion[]; statedTotal: number | null } {
  const criteria: RubricCriterion[] = [];
  let statedTotal: number | null = null;
  let buffer: string[] = [];
  let pendingMarks: number | null = null;

  const flush = (marks: number) => {
    const description = buffer.join(' ').replace(/\s+/g, ' ').trim();
    buffer = [];
    pendingMarks = null;
    if (!description) return;
    criteria.push({
      id: `${questionId}.c${criteria.length + 1}`,
      description,
      maxMarks: marks,
    });
  };

  for (const line of lines) {
    if (CRITERION_HEADER.test(line)) continue;

    const total = TOTAL_ROW.exec(line);
    if (total) {
      if (pendingMarks !== null) flush(pendingMarks);
      statedTotal = Number(total[1]);
      break;
    }

    const bare = BARE_NUMBER.exec(line);
    if (bare) {
      // Marks cell for the criterion whose text is still being buffered.
      if (pendingMarks !== null) flush(pendingMarks);
      pendingMarks = Number(bare[1]);
      continue;
    }

    const trailing = TRAILING_MARKS.exec(line);
    if (trailing) {
      // This line carries its own marks. Anything buffered belongs to the
      // previous criterion, which must therefore already have its marks.
      if (pendingMarks !== null) flush(pendingMarks);
      buffer.push(trailing[1] ?? '');
      flush(Number(trailing[2]));
      continue;
    }

    buffer.push(line);
  }

  if (pendingMarks !== null) flush(pendingMarks);
  if (buffer.length) {
    warnings.push(`${questionId}: ignored trailing rubric text with no marks value`);
  }
  return { criteria, statedTotal };
}

function sectionBetween(lines: string[], from: number, to: number): string {
  return lines
    .slice(from, to)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseQuestionBlock(block: Block, warnings: string[]): RubricQuestion | null {
  const id = `q${block.number}`;
  const rubricStart = block.lines.findIndex((l) => RUBRIC_HEADING.test(l));
  if (rubricStart === -1) {
    warnings.push(`${id}: no "Marking rubric" section found`);
    return null;
  }

  const guidanceStart = block.lines.findIndex(
    (l, i) => i > rubricStart && GUIDANCE_HEADING.test(l),
  );
  const tableEnd = guidanceStart === -1 ? block.lines.length : guidanceStart;

  const { criteria, statedTotal } = parseCriteriaTable(
    block.lines.slice(rubricStart + 1, tableEnd),
    id,
    warnings,
  );
  if (criteria.length === 0) {
    warnings.push(`${id}: rubric table had no criteria`);
    return null;
  }

  const summed = criteria.reduce((acc, c) => acc + c.maxMarks, 0);
  const declared = MODEL_ANSWER_HEADING.exec(
    block.lines.find((l) => MODEL_ANSWER_HEADING.test(l)) ?? '',
  );
  const declaredMax = declared ? Number(declared[1]) : null;
  const maxMarks = statedTotal ?? declaredMax ?? summed;

  if (Math.abs(summed - maxMarks) > 1e-6) {
    warnings.push(
      `${id}: criteria sum to ${summed} but the rubric states ${maxMarks}; using ${summed}`,
    );
  }

  const answerStart = block.lines.findIndex((l) => MODEL_ANSWER_HEADING.test(l));
  const modelAnswer = sectionBetween(
    block.lines,
    answerStart === -1 ? 0 : answerStart + 1,
    rubricStart,
  );

  return {
    id,
    number: block.number,
    subject: block.subject,
    prompt: '',
    maxMarks: summed,
    modelAnswer,
    criteria,
    guidance:
      guidanceStart === -1
        ? undefined
        : sectionBetween(block.lines, guidanceStart + 1, block.lines.length),
  };
}

/** Pulls each question's wording out of the question paper, when supplied. */
export function extractPrompts(questionPaperText: string): Map<number, string> {
  const prompts = new Map<number, string>();
  const lines = questionPaperText.split('\n').map((l) => l.trim());
  let current: number | null = null;
  let buffer: string[] = [];

  const commit = () => {
    if (current !== null && buffer.length) {
      prompts.set(current, buffer.join(' ').replace(/\s+/g, ' ').trim());
    }
    buffer = [];
  };

  for (const line of lines) {
    const heading = QUESTION_HEADING.exec(line);
    if (heading && line.length < 60) {
      commit();
      current = Number(heading[1]);
      continue;
    }
    if (current === null) continue;
    if (/^\d+(\.\d+)?\s*Marks?$/i.test(line)) continue;
    if (/^Expected answer:/i.test(line)) {
      commit();
      current = null;
      continue;
    }
    if (line) buffer.push(line);
  }
  commit();
  return prompts;
}

export function parseRubric(
  modelAnswerText: string,
  questionPaperText?: string,
): RubricParseResult {
  const warnings: string[] = [];
  const lines = modelAnswerText.split('\n').map((l) => l.trim());

  const title = lines.find((l) => l.length > 0) ?? 'Marking rubric';
  const blocks = splitIntoQuestions(lines);
  const questions: RubricQuestion[] = [];
  for (const block of blocks) {
    const parsed = parseQuestionBlock(block, warnings);
    if (parsed) questions.push(parsed);
  }

  if (questionPaperText) {
    const prompts = extractPrompts(questionPaperText);
    for (const q of questions) q.prompt = prompts.get(q.number) ?? '';
    const missing = questions.filter((q) => !q.prompt).map((q) => q.id);
    if (missing.length) {
      warnings.push(`no question text found for ${missing.join(', ')}`);
    }
  }

  return {
    rubric: {
      title,
      maxMarks: questions.reduce((acc, q) => acc + q.maxMarks, 0),
      questions,
    },
    warnings,
  };
}

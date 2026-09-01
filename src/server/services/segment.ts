import type { RubricQuestion } from '../../shared/types.js';

/**
 * Splits the student's paper into one block per question.
 *
 * Grading a question against only its own text stops evidence for Q1 being
 * quoted from Q3, and gives missing-point annotations somewhere sensible to
 * point at. When the paper has no usable headings we say so rather than
 * inventing boundaries.
 */

export interface AnswerBlock {
  questionId: string;
  start: number;
  end: number;
  text: string;
  /** False when the block is a guess because headings were not found. */
  located: boolean;
}

export interface SegmentResult {
  blocks: Map<string, AnswerBlock>;
  warnings: string[];
}

const HEADING_PATTERNS: RegExp[] = [
  /^\s*(?:answer|ans)\s*[-.:)]?\s*(\d+)\b/i,
  /^\s*q(?:uestion)?\s*[-.:)]?\s*(\d+)\b/i,
  /^\s*(\d+)\s*[.)]\s*$/,
];

function headingNumber(line: string): number | null {
  for (const pattern of HEADING_PATTERNS) {
    const match = pattern.exec(line);
    if (match?.[1]) {
      const value = Number(match[1]);
      if (Number.isFinite(value) && value > 0 && value < 100) return value;
    }
  }
  return null;
}

export function segmentAnswers(text: string, questions: RubricQuestion[]): SegmentResult {
  const warnings: string[] = [];
  const blocks = new Map<string, AnswerBlock>();

  // Find every heading with its offset in the original text.
  const found: { number: number; offset: number }[] = [];
  let offset = 0;
  for (const line of text.split('\n')) {
    const number = headingNumber(line);
    if (number !== null && !found.some((f) => f.number === number)) {
      found.push({ number, offset });
    }
    offset += line.length + 1;
  }

  const wanted = new Set(questions.map((q) => q.number));
  const usable = found.filter((f) => wanted.has(f.number)).sort((a, b) => a.offset - b.offset);

  if (usable.length === 0) {
    warnings.push(
      'no question headings were found on the answer paper; each question was graded against the whole answer',
    );
    for (const question of questions) {
      blocks.set(question.id, {
        questionId: question.id,
        start: 0,
        end: text.length,
        text,
        located: false,
      });
    }
    return { blocks, warnings };
  }

  usable.forEach((heading, index) => {
    const question = questions.find((q) => q.number === heading.number);
    if (!question) return;
    const end = usable[index + 1]?.offset ?? text.length;
    blocks.set(question.id, {
      questionId: question.id,
      start: heading.offset,
      end,
      text: text.slice(heading.offset, end),
      located: true,
    });
  });

  for (const question of questions) {
    if (blocks.has(question.id)) continue;
    warnings.push(`no heading found for question ${question.number}; graded against the whole answer`);
    blocks.set(question.id, {
      questionId: question.id,
      start: 0,
      end: text.length,
      text,
      located: false,
    });
  }

  return { blocks, warnings };
}

/** Text left once the answer-sheet furniture is removed, used for blank detection. */
export function meaningfulLength(text: string): number {
  const stripped = text
    .split('\n')
    .filter((line) => {
      const l = line.trim();
      if (!l) return false;
      if (/^(name|roll|class|total marks|page)\b/i.test(l)) return false;
      if (/answer sheet|question paper/i.test(l)) return false;
      if (headingNumber(l) !== null && l.length < 40) return false;
      if (/^_+$/.test(l.replace(/\s/g, ''))) return false;
      return true;
    })
    .join(' ')
    .replace(/[_\s]+/g, ' ')
    .trim();
  return stripped.length;
}

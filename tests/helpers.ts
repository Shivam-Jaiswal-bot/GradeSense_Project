/** Shared fixtures: the real papers, parsed once for the whole suite. */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { extractPdf } from '../src/server/services/pdfText.js';
import { parseRubric } from '../src/server/services/rubric.js';
import type { ExtractedDocument, Rubric } from '../src/shared/types.js';

const root = resolve(import.meta.dirname, '..');

export const PAPERS = {
  questionPaper: resolve(root, 'Product_Requirements_Details/GradeSense QP.pdf'),
  modelAnswer: resolve(root, 'Product_Requirements_Details/GradeSense MA.pdf'),
} as const;

export type AnswerVariant = 'planted' | 'correct' | 'incorrect' | 'ocr' | 'blank';

const ANSWER_FILES: Record<AnswerVariant, string> = {
  planted: 'fixtures/student-answer.pdf',
  correct: 'fixtures/student-answer-correct.pdf',
  incorrect: 'fixtures/student-answer-incorrect.pdf',
  ocr: 'fixtures/student-answer-ocr.pdf',
  blank: 'fixtures/student-answer-blank.pdf',
};

export function bytesOf(path: string): Promise<Buffer> {
  return readFile(resolve(root, path));
}

export function answerPath(variant: AnswerVariant): string {
  return resolve(root, ANSWER_FILES[variant]);
}

const extractCache = new Map<string, Promise<ExtractedDocument>>();

export function extract(path: string): Promise<ExtractedDocument> {
  const cached = extractCache.get(path);
  if (cached) return cached;
  const promise = readFile(path).then((bytes) => extractPdf(new Uint8Array(bytes)));
  extractCache.set(path, promise);
  return promise;
}

let rubricPromise: Promise<{ rubric: Rubric; warnings: string[] }> | null = null;

export function loadRubric(): Promise<{ rubric: Rubric; warnings: string[] }> {
  rubricPromise ??= (async () => {
    const [model, question] = await Promise.all([
      extract(PAPERS.modelAnswer),
      extract(PAPERS.questionPaper),
    ]);
    return parseRubric(model.text, question.text);
  })();
  return rubricPromise;
}

export function answer(variant: AnswerVariant): Promise<ExtractedDocument> {
  return extract(answerPath(variant));
}

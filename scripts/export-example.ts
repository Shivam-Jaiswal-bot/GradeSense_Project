/**
 * Produces the example deliverable: grades fixtures/student-answer.pdf against
 * the real marking scheme and writes the annotated copy plus the grading result
 * as JSON. Run with `npm run example`.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildAnnotations } from '../src/server/services/annotations.js';
import { buildAnnotatedPdf } from '../src/server/services/exportPdf.js';
import { gradePaper } from '../src/server/services/grader.js';
import { createProviders } from '../src/server/services/llm/index.js';
import { extractPdf } from '../src/server/services/pdfText.js';
import { parseRubric } from '../src/server/services/rubric.js';

const root = resolve(import.meta.dirname, '..');
const answerFile = process.argv[2] ?? 'fixtures/student-answer.pdf';
const outFile = process.argv[3] ?? 'fixtures/example-annotated-answer.pdf';

async function read(path: string) {
  return extractPdf(new Uint8Array(await readFile(resolve(root, path))));
}

const [model, question, student] = await Promise.all([
  read('Product_Requirements_Details/GradeSense MA.pdf'),
  read('Product_Requirements_Details/GradeSense QP.pdf'),
  read(answerFile),
]);

const { rubric, warnings } = parseRubric(model.text, question.text);
const providers = createProviders(process.env);

const run = await gradePaper({
  rubric,
  studentText: student.text,
  spans: student.spans,
  pages: student.pages,
  studentDocumentId: answerFile,
  studentName: 'Ananya Sharma',
  providers,
});
run.adjustments.push(...warnings);

const annotations = buildAnnotations({
  run,
  documentText: student.text,
  spans: student.spans,
  pages: student.pages,
}).map((draft, index) => ({
  ...draft,
  id: `example-${index + 1}`,
  createdAt: run.createdAt,
  updatedAt: run.createdAt,
  edited: false,
}));

const pdf = await buildAnnotatedPdf({
  originalPdf: await readFile(resolve(root, answerFile)),
  run,
  annotations,
});

await writeFile(resolve(root, outFile), pdf);
await writeFile(
  resolve(root, outFile.replace(/\.pdf$/, '.json')),
  `${JSON.stringify({ run, annotations }, null, 2)}\n`,
);

console.log(
  `graded ${answerFile}: ${run.awardedMarks}/${run.maxMarks} ` +
    `(${(run.confidence * 100).toFixed(0)}% confidence, review=${run.needsHumanReview}) ` +
    `via ${run.provider}`,
);
console.log(`wrote ${outFile} with ${annotations.length} annotations`);

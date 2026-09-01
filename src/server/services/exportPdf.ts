/**
 * Builds the annotated copy of an answer paper.
 *
 * The original upload is never touched: its bytes are loaded, drawn onto in
 * memory, and saved as a new file. Marks are numbered on the page and the
 * numbers are explained on an appended examiner's report, so a printed copy
 * stays readable even where the page has no room for a comment.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { Annotation, GradingRun } from '../../shared/types.js';

const RED = rgb(0.79, 0.16, 0.16);
const AMBER = rgb(0.85, 0.55, 0.1);
const BLUE = rgb(0.17, 0.35, 0.68);
const INK = rgb(0.11, 0.13, 0.18);
const GREY = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.83, 0.85, 0.88);

const MARGIN = 48;
const REPORT_LEADING = 13;

function colourFor(annotation: Annotation) {
  if (annotation.severity === 'error') return RED;
  if (annotation.severity === 'warning') return AMBER;
  return BLUE;
}

/** WinAnsi-safe: pdf-lib's standard fonts throw on characters outside it. */
function safe(text: string): string {
  return text
    .replace(/₹/g, 'Rs.')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/→/g, '->')
    .replace(/[–—]/g, '-')
    .replace(/•/g, '-')
    .replace(/[^\x20-\xff\n]/g, ' ');
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of safe(text).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > width && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

export interface ExportInput {
  originalPdf: Buffer | Uint8Array;
  run: GradingRun;
  annotations: Annotation[];
  studentName?: string | null;
}

export async function buildAnnotatedPdf(input: ExportInput): Promise<Uint8Array> {
  const doc = await PDFDocument.load(new Uint8Array(input.originalPdf));
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();

  const numbered = [...input.annotations].sort(
    (a, b) => a.page - b.page || b.y - a.y || a.x - b.x,
  );

  numbered.forEach((annotation, index) => {
    const page = pages[annotation.page - 1];
    if (!page) return; // A stale page number must not abort the export.
    drawMark(page, annotation, index + 1, bold);
  });

  drawReport(doc, font, bold, input.run, numbered);
  return doc.save();
}

function drawMark(page: PDFPage, annotation: Annotation, number: number, bold: PDFFont): void {
  const colour = colourFor(annotation);
  const { x, y, width, height } = annotation;

  switch (annotation.style) {
    case 'underline':
      page.drawLine({
        start: { x, y: y - 1.5 },
        end: { x: x + width, y: y - 1.5 },
        thickness: 1.1,
        color: colour,
      });
      break;
    case 'strikethrough':
      page.drawLine({
        start: { x, y: y + height / 2 },
        end: { x: x + width, y: y + height / 2 },
        thickness: 1.1,
        color: colour,
      });
      break;
    case 'note':
      // A note carries no shape on the page: an answer sheet has no white
      // space to put one in without covering the student's writing. It gets a
      // numbered marker, and its text is printed in the appended report.
      break;
    case 'box':
    default:
      page.drawRectangle({
        x: x - 2,
        y: y - 2,
        width: width + 4,
        height: height + 4,
        borderColor: colour,
        borderWidth: 1.1,
      });
      break;
  }

  // The number ties the mark to its entry in the appended report.
  const badgeX = annotation.style === 'note' ? x + 6 : Math.max(MARGIN * 0.35, x - 13);
  const badgeY = annotation.style === 'note' ? y + annotation.height - 9 : y + height / 2;
  page.drawCircle({ x: badgeX, y: badgeY, size: 6.5, color: colour });
  const label = String(number);
  page.drawText(label, {
    x: badgeX - bold.widthOfTextAtSize(label, 7) / 2,
    y: badgeY - 2.5,
    size: 7,
    font: bold,
    color: rgb(1, 1, 1),
  });

}

/**
 * The examiner's report: the score breakdown, why the marks were given, and the
 * numbered comment for every mark on the paper.
 */
function drawReport(
  doc: PDFDocument,
  font: PDFFont,
  bold: PDFFont,
  run: GradingRun,
  annotations: Annotation[],
): void {
  const size = doc.getPage(0).getSize();
  let page = doc.addPage([size.width, size.height]);
  let y = size.height - MARGIN;
  const width = size.width - MARGIN * 2;

  const ensure = (needed: number) => {
    if (y - needed > MARGIN) return;
    page = doc.addPage([size.width, size.height]);
    y = size.height - MARGIN;
  };

  const write = (
    text: string,
    options: { font?: PDFFont; size?: number; color?: typeof INK; indent?: number } = {},
  ) => {
    const f = options.font ?? font;
    const s = options.size ?? 9.5;
    for (const line of wrap(text, f, s, width - (options.indent ?? 0))) {
      ensure(REPORT_LEADING);
      page.drawText(line, {
        x: MARGIN + (options.indent ?? 0),
        y,
        size: s,
        font: f,
        color: options.color ?? INK,
      });
      y -= REPORT_LEADING;
    }
  };

  const rule = () => {
    ensure(10);
    page.drawLine({
      start: { x: MARGIN, y: y + 4 },
      end: { x: size.width - MARGIN, y: y + 4 },
      thickness: 0.7,
      color: RULE,
    });
    y -= 8;
  };

  write('Examiner report', { font: bold, size: 15 });
  y -= 4;
  write(
    `${run.awardedMarks} / ${run.maxMarks} marks   -   confidence ${(run.confidence * 100).toFixed(
      0,
    )}%   -   graded by ${run.provider} (${run.model})`,
    { font: bold, size: 10.5 },
  );
  write(`Run ${run.id} - ${new Date(run.createdAt).toLocaleString()}`, {
    size: 8.5,
    color: GREY,
  });
  y -= 4;

  if (run.needsHumanReview) {
    write('FLAGGED FOR HUMAN REVIEW', { font: bold, size: 10, color: RED });
    for (const reason of run.reviewReasons) write(`- ${reason}`, { size: 9, indent: 10 });
    y -= 4;
  }
  rule();

  for (const question of run.questions) {
    ensure(40);
    write(
      `Question ${question.number} (${question.subject}) - ${question.awardedMarks} / ${question.maxMarks}`,
      { font: bold, size: 11 },
    );
    for (const criterion of question.criteria) {
      write(
        `${criterion.awardedMarks}/${criterion.maxMarks}  ${criterion.status.toUpperCase()}  ${
          criterion.description
        }`,
        { size: 9, indent: 10 },
      );
      if (criterion.evidence[0]?.quote) {
        write(`evidence: "${criterion.evidence[0].quote}"`, {
          size: 8.5,
          indent: 22,
          color: GREY,
        });
      }
      if (criterion.feedback) write(criterion.feedback, { size: 8.5, indent: 22, color: GREY });
      if (criterion.correction) {
        write(`should say: ${criterion.correction}`, { size: 8.5, indent: 22, color: GREY });
      }
    }
    y -= 4;
  }

  if (annotations.length > 0) {
    rule();
    write('Marks on the paper', { font: bold, size: 11 });
    annotations.forEach((annotation, index) => {
      ensure(REPORT_LEADING * 2);
      const lost = annotation.marksLost > 0 ? ` (-${annotation.marksLost})` : '';
      const placed = annotation.anchored ? '' : ' [placed in the margin: text not located]';
      const touched = annotation.edited ? ' [edited by examiner]' : '';
      write(
        `${index + 1}. page ${annotation.page}${lost}${placed}${touched} - ${annotation.text}`,
        { size: 9, indent: 10 },
      );
    });
  }

  rule();
  if (run.adjustments.length > 0) {
    write('Automatic corrections applied to the grading output', {
      font: bold,
      size: 9.5,
      color: GREY,
    });
    for (const adjustment of run.adjustments) {
      write(`- ${adjustment}`, { size: 8.5, indent: 10, color: GREY });
    }
  }
  write(
    'This is an annotated copy. The original answer paper is stored unchanged.',
    { size: 8.5, color: GREY },
  );
}

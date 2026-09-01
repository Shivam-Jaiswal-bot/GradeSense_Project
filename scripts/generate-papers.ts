/**
 * Builds the sample papers in fixtures/:
 *   answer-sheet-template.pdf  blank sheet
 *   student-answer.pdf         the authored answer with deliberate mistakes
 *   student-answer-*.pdf       variants used by the test suite
 *   error-key.md               generated from the same source as the answer
 *
 * Run with: npm run papers
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDFDocument, rgb } from 'pdf-lib';
import { A4, Cursor, GREY, INK, MARGIN, PEN, createDoc, ruledLines, toWinAnsi } from './lib/pdfDraw.js';
import { drawCircuit, drawSupplyDemand } from './lib/figures.js';
import {
  CORRECT_POINTS,
  ERROR_KEY,
  STUDENT_ANSWER,
  STUDENT_HEADER,
  type AnswerQuestion,
} from './lib/studentContent.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'fixtures');

type Fonts = Awaited<ReturnType<typeof createDoc>>['fonts'];

/** Full header box for page 1. Returns the y that body text may start at. */
function drawSheetHeader(page: import('pdf-lib').PDFPage, fonts: Fonts, withDetails: boolean): number {
  const top = A4[1] - MARGIN;
  page.drawRectangle({
    x: MARGIN - 10,
    y: top - 54,
    width: A4[0] - (MARGIN - 10) * 2,
    height: 62,
    borderColor: rgb(0.7, 0.72, 0.78),
    borderWidth: 0.8,
  });
  page.drawText(toWinAnsi(STUDENT_HEADER.paper), {
    x: MARGIN,
    y: top - 8,
    size: 11,
    font: fonts.bold,
    color: INK,
  });
  const fields = withDetails
    ? [`Name: ${STUDENT_HEADER.name}`, STUDENT_HEADER.roll, STUDENT_HEADER.className]
    : ['Name: ______________________', 'Roll No: ____________', 'Class: ____________'];
  page.drawText(toWinAnsi(fields.join('     ')), {
    x: MARGIN,
    y: top - 30,
    size: 9.5,
    font: withDetails ? fonts.hand : fonts.body,
    color: withDetails ? PEN : GREY,
  });
  page.drawText('Total marks: 15', {
    x: MARGIN,
    y: top - 46,
    size: 9,
    font: fonts.body,
    color: GREY,
  });
  return top - 74;
}

/** Slim running header for continuation pages. */
function drawContinuationHeader(
  page: import('pdf-lib').PDFPage,
  fonts: Fonts,
  pageNumber: number,
  withDetails: boolean,
): number {
  const top = A4[1] - MARGIN;
  const who = withDetails ? `${STUDENT_HEADER.name} - ${STUDENT_HEADER.roll}` : 'Answer sheet';
  page.drawText(toWinAnsi(`${who}   |   Page ${pageNumber}`), {
    x: MARGIN,
    y: top - 2,
    size: 8.5,
    font: fonts.body,
    color: GREY,
  });
  page.drawLine({
    start: { x: MARGIN, y: top - 10 },
    end: { x: A4[0] - MARGIN, y: top - 10 },
    thickness: 0.6,
    color: rgb(0.78, 0.8, 0.85),
  });
  return top - 30;
}

async function buildAnswerPdf(questions: AnswerQuestion[], withDetails = true): Promise<Uint8Array> {
  const { doc, fonts } = await createDoc();
  const cursor = new Cursor(doc, fonts, (page, pageNumber) =>
    pageNumber === 1
      ? drawSheetHeader(page, fonts, withDetails)
      : drawContinuationHeader(page, fonts, pageNumber, withDetails),
  );

  for (const question of questions) {
    cursor.ensure(90);
    cursor.line(question.heading, { font: fonts.handBold, size: 12.5, color: PEN });
    cursor.space(4);

    for (const paragraph of question.paragraphs) {
      cursor.paragraph(paragraph.text, {
        font: fonts.hand,
        size: 11,
        color: PEN,
        leading: 16.5,
        indent: paragraph.indent ?? 0,
      });
      cursor.space(7);
    }

    if (question.figure) {
      const height = question.figure === 'circuit' ? 210 : 220;
      cursor.ensure(height);
      const style = question.figureStyle ?? 'flawed';
      const after =
        question.figure === 'circuit'
          ? drawCircuit(cursor.page, fonts, cursor.y - 24, style)
          : drawSupplyDemand(cursor.page, fonts, cursor.y - 12, style);
      cursor.y = after;
      if (question.caption) {
        // captionOffset pushes the caption out of the text column on purpose.
        cursor.page.drawText(toWinAnsi(question.caption), {
          x: MARGIN + (question.captionOffset ?? 0),
          y: cursor.y,
          size: 9.5,
          font: fonts.hand,
          color: PEN,
        });
        cursor.y -= 22;
      }
    }
    cursor.space(10);
  }

  return doc.save();
}

async function buildBlankTemplate(): Promise<Uint8Array> {
  const { doc, fonts } = await createDoc();
  for (let i = 0; i < 2; i++) {
    const page = doc.addPage(A4);
    const top =
      (i === 0
        ? drawSheetHeader(page, fonts, false)
        : drawContinuationHeader(page, fonts, i + 1, false)) - 6;
    if (i === 0) {
      page.drawText('Answer 1.', { x: MARGIN, y: top, size: 11, font: fonts.bold, color: GREY });
      ruledLines(page, top - 18, MARGIN + 20);
    } else {
      ruledLines(page, top + 10, MARGIN + 20);
    }
    page.drawText(`Page ${i + 1} of 2`, {
      x: A4[0] - MARGIN - 50,
      y: MARGIN - 14,
      size: 8,
      font: fonts.body,
      color: GREY,
    });
  }
  return doc.save();
}

/* ---------------- variants used by the tests ---------------- */

const CORRECT_VARIANT: AnswerQuestion[] = [
  {
    id: 'q1',
    heading: 'Answer 1. (Science)',
    figure: 'circuit',
    figureStyle: 'correct',
    caption: 'Fig. 1 - Circuit diagram',
    paragraphs: [
      {
        text: 'A simple electric circuit is a closed conducting path through which current can flow. The battery provides the potential difference that drives the current, and the switch opens or closes the circuit. When the switch is closed the path is complete and current flows through the bulb and the resistor.',
      },
      {
        text: 'The battery, switch, resistor, bulb and ammeter are connected in series in the main circuit. The ammeter is connected in series because it measures the current flowing through the circuit. The voltmeter is connected in parallel across the bulb because it measures the potential difference between the two ends of the bulb.',
      },
      {
        text: 'The conventional current flows from the positive terminal of the battery through the external circuit and back to the negative terminal, and this direction is marked on the diagram.',
      },
      {
        text: 'By Ohm\'s law, V = IR. If the voltage of the battery stays constant and the resistance is increased, the current flowing through the circuit decreases. Reducing the resistance allows more current to flow.',
      },
    ],
  },
  {
    id: 'q2',
    heading: 'Answer 2. (English)',
    paragraphs: [
      {
        text: 'Technology has made information far easier to reach, but I believe it only makes students better learners when it is used to support their own thinking rather than replace it.',
      },
      {
        text: 'Access to digital libraries and video explanations genuinely helps. A student who cannot follow one explanation of refraction can watch three more until one makes sense, which a single classroom lesson cannot offer. However, the same access allows a student to search for a solution before attempting the problem, and a student who never struggles with a question never develops the reasoning to answer the next one.',
      },
      {
        text: 'It is fair to argue that easy access simply saves time, and that the time saved can be spent on deeper study. That is true for a student who already knows how to study, but for most students the saved time is not reinvested; the answer is copied and the reasoning is skipped.',
      },
      {
        text: 'Technology is therefore best understood as a tool that supports thinking. Used to check and extend your own reasoning it makes learning far better; used as a substitute for reasoning it makes learning worse.',
      },
    ],
  },
  {
    id: 'q3',
    heading: 'Answer 3. (Economics)',
    figure: 'supplyDemand',
    figureStyle: 'correct',
    caption: 'Fig. 2 - Demand and supply',
    paragraphs: [
      {
        text: 'The graph is drawn with quantity on the horizontal axis and price on the vertical axis. The demand curve slopes downward from left to right and the supply curve slopes upward from left to right.',
      },
      {
        text: 'The two curves intersect at a price of Rs. 30 and a quantity of 60 units. This is the market equilibrium because at that price the quantity demanded is equal to the quantity supplied.',
      },
      {
        text: 'If the price is below the equilibrium price, quantity demanded exceeds quantity supplied and there is a shortage, which pushes the price up. If the price is above the equilibrium price, quantity supplied exceeds quantity demanded and there is a surplus, which pushes the price down.',
      },
      {
        text: 'If the cost of production increases, producers supply less at every price, so the supply curve shifts to the left. The new equilibrium is at a higher price and a lower quantity, assuming demand is unchanged.',
      },
    ],
  },
];

const INCORRECT_VARIANT: AnswerQuestion[] = [
  {
    id: 'q1',
    heading: 'Answer 1. (Science)',
    paragraphs: [
      {
        text: 'An electric circuit is a wire. The battery stores current inside it and the current gets used up by the bulb, so nothing comes back to the battery. The switch makes the bulb brighter.',
      },
      {
        text: 'The ammeter should be connected in parallel and the voltmeter should be connected in series, because the ammeter is a bigger instrument. If the resistance is increased the current also increases.',
      },
    ],
  },
  {
    id: 'q2',
    heading: 'Answer 2. (English)',
    paragraphs: [
      {
        text: 'Technology is a machine. Computers are used in offices and schools. Mobile phones are also technology and they are very costly nowadays. Students should study hard and respect their teachers.',
      },
    ],
  },
  {
    id: 'q3',
    heading: 'Answer 3. (Economics)',
    paragraphs: [
      {
        text: 'Demand means what people want and supply means what shops have. The equilibrium is at Rs. 50 and 100 units because that is the biggest number in the table. If the cost of production increases the supply curve shifts to the right and the price becomes lower.',
      },
    ],
  },
];

/** Correct content, corrupted the way a weak OCR pass corrupts a scan. */
function ocrCorrupt(text: string): string {
  const swaps: [RegExp, string][] = [
    [/\bcircuit\b/g, 'circuil'],
    [/\bammeter\b/g, 'arnmeter'],
    [/\bvoltmeter\b/g, 'voltrneter'],
    [/\bresistance\b/g, 'resistanoe'],
    [/\bequilibrium\b/g, 'equilibriurn'],
    [/\bcurrent\b/g, 'currenl'],
    [/\bquantity\b/g, 'quantlty'],
    [/\bsupply\b/g, 'supp1y'],
    [/\bparallel\b/g, 'paralle1'],
  ];
  return swaps.reduce((acc, [from, to]) => acc.replace(from, to), text);
}

const OCR_VARIANT: AnswerQuestion[] = CORRECT_VARIANT.map((q) => ({
  ...q,
  paragraphs: q.paragraphs.map((p) => ({ ...p, text: ocrCorrupt(p.text) })),
}));

/* ---------------- error key ---------------- */

function buildErrorKey(): string {
  const byQuestion = new Map<string, typeof ERROR_KEY>();
  for (const e of ERROR_KEY) {
    byQuestion.set(e.questionId, [...(byQuestion.get(e.questionId) ?? []), e]);
  }
  const titles: Record<string, string> = {
    q1: 'Q1 - Science (5 marks)',
    q2: 'Q2 - English (5 marks)',
    q3: 'Q3 - Economics (5 marks)',
  };

  const lines: string[] = [
    '# Error key - `fixtures/student-answer.pdf`',
    '',
    `Student: **${STUDENT_HEADER.name}**, ${STUDENT_HEADER.roll}.`,
    '',
    'Every mistake below was placed deliberately. This file is generated from',
    '`scripts/lib/studentContent.ts`, the same source the answer PDF is rendered',
    'from, so the key cannot drift from the paper.',
    '',
    `**${ERROR_KEY.length} intended mistakes** across three answers: `,
    [
      `${ERROR_KEY.filter((e) => e.type === 'factual_error').length} factual`,
      `${ERROR_KEY.filter((e) => e.type === 'wrong_reasoning').length} wrong reasoning`,
      `${ERROR_KEY.filter((e) => e.type === 'missing_point').length} missing points`,
      `${ERROR_KEY.filter((e) => e.type === 'spelling').length} spelling`,
      `${ERROR_KEY.filter((e) => e.type === 'grammar').length} grammar`,
      `${ERROR_KEY.filter((e) => e.type === 'layout').length} layout`,
      ].join(', ') + '.',
    '',
  ];

  for (const [qid, title] of Object.entries(titles)) {
    lines.push(`## ${title}`, '');
    lines.push('| # | Type | Rubric | What the answer says | What it should say |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const e of byQuestion.get(qid) ?? []) {
      const quote = e.quote ? `"${e.quote}"` : '_(nothing written)_';
      lines.push(
        `| ${e.id} | ${e.type.replace('_', ' ')} | ${e.criterionId ?? '-'} | ${quote} | ${e.correction} |`,
      );
    }
    lines.push('');
    const notes = (byQuestion.get(qid) ?? []).filter((e) => e.note);
    if (notes.length) {
      lines.push('Notes:', '');
      for (const e of notes) lines.push(`- **${e.id}** - ${e.note}`);
      lines.push('');
    }
    const good = CORRECT_POINTS.filter((c) => c.questionId === qid);
    if (good.length) {
      lines.push('Points the answer earns:', '');
      for (const c of good) lines.push(`- \`${c.criterionId}\` - ${c.note}`);
      lines.push('');
    }
  }

  lines.push(
    '## Expected shape of a correct grading',
    '',
    'Six of the fifteen rubric criteria are clearly earned and six are clearly',
    'lost, with `q1.c5` (labelling and structure) a partial. A grader that scores',
    'this paper in the 6-9 range, and that names the voltmeter placement, the',
    'inverted Ohm\'s law reasoning, the swapped axes, the swapped shortage/surplus',
    'and the self-contradicting conclusion, is reading the answer rather than',
    'matching it against the model answer.',
    '',
    '## Other fixtures',
    '',
    '| File | Purpose |',
    '| --- | --- |',
    '| `student-answer-correct.pdf` | A near-model answer. Should score at or near 15/15. |',
    '| `student-answer-incorrect.pdf` | Confidently wrong throughout. Should score at or near 0. |',
    '| `student-answer-blank.pdf` | Nothing written. Must score 0 and be flagged for review, not guessed at. |',
    '| `student-answer-ocr.pdf` | The correct answer with OCR-style corruption. Should still score high. |',
    '| `answer-sheet-template.pdf` | The blank sheet the answers are written on. |',
    '',
  );
  return lines.join('\n');
}

/* ---------------- main ---------------- */

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });

  const outputs: [string, Uint8Array][] = [
    ['answer-sheet-template.pdf', await buildBlankTemplate()],
    ['student-answer.pdf', await buildAnswerPdf(STUDENT_ANSWER)],
    ['student-answer-correct.pdf', await buildAnswerPdf(CORRECT_VARIANT)],
    ['student-answer-incorrect.pdf', await buildAnswerPdf(INCORRECT_VARIANT)],
    ['student-answer-ocr.pdf', await buildAnswerPdf(OCR_VARIANT)],
    ['student-answer-blank.pdf', await buildBlankTemplate()],
  ];

  for (const [name, bytes] of outputs) {
    writeFileSync(resolve(OUT, name), bytes);
    console.log(`wrote fixtures/${name} (${(bytes.length / 1024).toFixed(1)} kB)`);
  }

  writeFileSync(resolve(OUT, 'error-key.md'), buildErrorKey());
  console.log('wrote fixtures/error-key.md');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

import { randomUUID } from 'node:crypto';
import type {
  Annotation,
  AnnotationStyle,
  GradingIssue,
  GradingRun,
  IssueType,
  PageGeometry,
  Rect,
  TextSpan,
} from '../../shared/types.js';
import { locate, rectsForRange } from './anchor.js';

/**
 * Builds the first set of annotations for a run.
 *
 * They are generated once, from the grading issues, and then stored as
 * independent rows. Everything after this point - moving, retyping, deleting,
 * adding a mark by hand - happens on the stored annotations and never re-runs
 * the grader.
 */

const STYLE_BY_TYPE: Record<IssueType, AnnotationStyle> = {
  missing_point: 'note',
  wrong_reasoning: 'box',
  factual_error: 'box',
  spelling: 'underline',
  grammar: 'underline',
  layout: 'note',
};

const SEVERITY_BY_TYPE: Record<IssueType, Annotation['severity']> = {
  missing_point: 'warning',
  wrong_reasoning: 'error',
  factual_error: 'error',
  spelling: 'info',
  grammar: 'info',
  layout: 'info',
};

const NOTE_WIDTH = 150;
const NOTE_HEIGHT = 34;
const NOTE_GAP = 8;

export interface BuildAnnotationsInput {
  run: GradingRun;
  documentText: string;
  spans: TextSpan[];
  pages: PageGeometry[];
}

export function buildAnnotations(input: BuildAnnotationsInput): Annotation[] {
  const { run, documentText, spans, pages } = input;
  const now = new Date().toISOString();
  const annotations: Annotation[] = [];
  // Tracks where the next margin note may sit on each page.
  const marginCursor = new Map<number, number>();

  for (const question of run.questions) {
    for (const issue of question.issues) {
      const rect = issue.quote
        ? anchorToQuote(issue.quote, documentText, spans)
        : null;

      if (rect) {
        annotations.push(
          makeAnnotation(issue, rect, STYLE_BY_TYPE[issue.type], true, now, run.id),
        );
        continue;
      }

      // Nothing to point at - a missing point, or a quote we could not verify.
      // Park it in the margin beside the question rather than guessing.
      const fallback = marginRect(question.answerRange, spans, pages, marginCursor);
      annotations.push(makeAnnotation(issue, fallback, 'note', false, now, run.id));
    }
  }

  return annotations;
}

function anchorToQuote(
  quote: string,
  documentText: string,
  spans: TextSpan[],
): Rect | null {
  const located = locate(quote, documentText);
  if (!located) return null;
  const rects = rectsForRange(located, spans);
  if (rects.length === 0) return null;
  // Multi-line quotes get one mark on the first line; the teacher can resize it.
  const first = rects[0]!;
  const sameLine = rects.filter((r) => r.page === first.page && Math.abs(r.y - first.y) < 3);
  const right = Math.max(...sameLine.map((r) => r.x + r.width));
  return { page: first.page, x: first.x, y: first.y, width: right - first.x, height: first.height };
}

/** Places an unanchored note in the right margin next to the question block. */
function marginRect(
  range: { start: number; end: number } | undefined,
  spans: TextSpan[],
  pages: PageGeometry[],
  cursor: Map<number, number>,
): Rect {
  const inRange = range
    ? spans.filter((s) => s.offset >= range.start && s.offset < range.end)
    : spans;
  const anchor = inRange[0] ?? spans[0];
  const page = pages.find((p) => p.page === (anchor?.page ?? 1)) ?? pages[0];
  const pageWidth = page?.width ?? 595.28;
  const pageHeight = page?.height ?? 841.89;
  const pageNo = page?.page ?? 1;

  const startY = cursor.get(pageNo) ?? (anchor ? anchor.y : pageHeight - 90);
  const y = Math.max(startY, 40);
  cursor.set(pageNo, y - NOTE_HEIGHT - NOTE_GAP);

  return {
    page: pageNo,
    // Sits in the right margin, clear of the text column.
    x: Math.max(pageWidth - NOTE_WIDTH - 16, 20),
    y,
    width: NOTE_WIDTH,
    height: NOTE_HEIGHT,
  };
}

function makeAnnotation(
  issue: GradingIssue,
  rect: Rect,
  style: AnnotationStyle,
  anchored: boolean,
  now: string,
  runId: string,
): Annotation {
  return {
    id: randomUUID(),
    runId,
    issueId: issue.id,
    questionId: issue.questionId,
    style,
    severity: SEVERITY_BY_TYPE[issue.type],
    page: rect.page,
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    text: annotationText(issue),
    marksLost: issue.marksLost,
    edited: false,
    anchored,
    createdAt: now,
    updatedAt: now,
  };
}

function annotationText(issue: GradingIssue): string {
  const parts: string[] = [];
  if (issue.comment) parts.push(issue.comment);
  if (issue.correction && issue.correction !== issue.comment) {
    parts.push(`Correct: ${issue.correction}`);
  }
  return parts.join(' ').trim() || 'Review this point.';
}

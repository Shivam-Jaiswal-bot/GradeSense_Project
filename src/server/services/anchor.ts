import type { Rect, TextSpan } from '../../shared/types.js';
import { levenshtein, ocrNormalise, stem } from './text.js';

/**
 * Maps a quote from the grader back onto the page.
 *
 * Annotation quality lives or dies here. A quote that cannot be located is not
 * drawn in a guessed position - it is reported as unanchored, so the paper
 * never carries a mark pointing at the wrong words.
 */

export interface Located {
  start: number;
  end: number;
  /** 1 for an exact match, lower for a fuzzy one. */
  score: number;
}

interface NormalisedText {
  text: string;
  /** map[i] is the offset in the original text of normalised character i. */
  map: number[];
}

function normalise(input: string): NormalisedText {
  const chars: string[] = [];
  const map: number[] = [];
  let lastWasSpace = true;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        chars.push(' ');
        map.push(i);
        lastWasSpace = true;
      }
      continue;
    }
    chars.push(ch.toLowerCase());
    map.push(i);
    lastWasSpace = false;
  }
  return { text: chars.join(''), map };
}

interface Word {
  text: string;
  start: number;
  end: number;
}

function words(text: string): Word[] {
  const out: Word[] = [];
  const re = /[^\s]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    out.push({
      text: stem(ocrNormalise(match[0].replace(/[^a-z0-9']/gi, '').toLowerCase())),
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return out.filter((w) => w.text.length > 0);
}

function sameWord(a: string, b: string): boolean {
  if (a === b) return true;
  const allowed = a.length >= 8 ? 2 : a.length >= 5 ? 1 : 0;
  return allowed > 0 && levenshtein(a, b, allowed) <= allowed;
}

/**
 * Finds a quote in the document text. Tries an exact (whitespace-insensitive)
 * match first, then a word-window search that tolerates OCR damage and the
 * small paraphrases a model sometimes slips into a quote.
 */
export function locate(quote: string, documentText: string, minScore = 0.65): Located | null {
  const trimmed = quote.trim();
  if (trimmed.length < 3) return null;

  const doc = normalise(documentText);
  const needle = normalise(trimmed);
  if (needle.text.length === 0) return null;

  const exact = doc.text.indexOf(needle.text);
  if (exact !== -1) {
    const start = doc.map[exact]!;
    const endIndex = exact + needle.text.length - 1;
    return { start, end: doc.map[endIndex]! + 1, score: 1 };
  }

  // Word-window fallback.
  const docWords = words(documentText);
  const quoteWords = words(trimmed);
  if (quoteWords.length === 0 || docWords.length === 0) return null;

  const size = quoteWords.length;
  let best: Located | null = null;
  // Allow the window to flex a little: models drop or add a word in a quote.
  for (const width of [size, size - 1, size + 1].filter((w) => w > 0)) {
    for (let i = 0; i + width <= docWords.length; i++) {
      const window = docWords.slice(i, i + width);
      let matched = 0;
      let cursor = 0;
      for (const qw of quoteWords) {
        for (let j = cursor; j < window.length; j++) {
          if (sameWord(qw.text, window[j]!.text)) {
            matched++;
            cursor = j + 1;
            break;
          }
        }
      }
      const score = matched / quoteWords.length;
      if (score >= minScore && (!best || score > best.score)) {
        best = { start: window[0]!.start, end: window[window.length - 1]!.end, score };
      }
      if (best?.score === 1) break;
    }
    if (best?.score === 1) break;
  }
  return best;
}

/**
 * Converts a character range into page rectangles, one per visual line.
 * A span that is only partly covered is sliced proportionally by character
 * count, which is accurate enough for an underline on proportional text and
 * avoids needing font metrics on the server.
 */
export function rectsForRange(range: Located, spans: TextSpan[], padding = 1.5): Rect[] {
  const hits: Rect[] = [];
  for (const span of spans) {
    const spanStart = span.offset;
    const spanEnd = span.offset + span.text.length;
    const start = Math.max(range.start, spanStart);
    const end = Math.min(range.end, spanEnd);
    if (end <= start) continue;

    const length = span.text.length || 1;
    const fromRatio = (start - spanStart) / length;
    const toRatio = (end - spanStart) / length;
    const x = span.x + span.width * fromRatio;
    const width = Math.max(span.width * (toRatio - fromRatio), 2);
    hits.push({
      page: span.page,
      x: x - padding,
      y: span.y - padding * 2,
      width: width + padding * 2,
      height: span.height + padding * 2,
    });
  }
  return mergeRects(hits);
}

/** Joins rectangles that sit on the same line so an underline is continuous. */
export function mergeRects(rects: Rect[]): Rect[] {
  const sorted = [...rects].sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const merged: Rect[] = [];
  for (const rect of sorted) {
    const last = merged[merged.length - 1];
    const sameLine =
      last && last.page === rect.page && Math.abs(last.y - rect.y) <= Math.max(rect.height * 0.5, 2);
    const adjacent = last && rect.x - (last.x + last.width) <= 6;
    if (last && sameLine && adjacent) {
      const right = Math.max(last.x + last.width, rect.x + rect.width);
      last.x = Math.min(last.x, rect.x);
      last.width = right - last.x;
      last.height = Math.max(last.height, rect.height);
      last.y = Math.min(last.y, rect.y);
    } else {
      merged.push({ ...rect });
    }
  }
  return merged;
}

/** The single box an annotation gets: the first line of a multi-line match. */
export function primaryRect(rects: Rect[]): Rect | null {
  return rects[0] ?? null;
}

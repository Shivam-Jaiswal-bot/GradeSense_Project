import { createRequire } from 'node:module';
import type { ExtractedDocument, PageGeometry, TextSpan } from '../../shared/types.js';

const require = createRequire(import.meta.url);

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjsPromise: Promise<PdfJs> | null = null;

/**
 * pdf.js is loaded lazily: it is a heavy ESM module and the worker path has to
 * be resolved from disk, which we only want to pay for when a PDF arrives.
 */
async function getPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      installPromiseWithResolvers();
      const pdfjs = (await import('pdfjs-dist/legacy/build/pdf.mjs')) as PdfJs;
      pdfjs.GlobalWorkerOptions.workerSrc = require.resolve(
        'pdfjs-dist/legacy/build/pdf.worker.mjs',
      );
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

/**
 * pdf.js v6 uses Promise.withResolvers, which only landed in Node 22. We
 * support Node 20, so install the (tiny, spec-equivalent) shim when missing.
 */
function installPromiseWithResolvers(): void {
  const ctor = Promise as unknown as { withResolvers?: unknown };
  if (typeof ctor.withResolvers === 'function') return;
  ctor.withResolvers = function withResolvers<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

/** Collapse runs of whitespace so offsets computed here match the text we grade. */
export function normaliseWhitespace(input: string): string {
  return input.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ');
}

interface RawItem {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Group text items into visual lines. pdf.js emits items in content-stream
 * order, which is usually but not always reading order, so we bucket by
 * baseline y (with a tolerance) and sort each bucket left-to-right.
 */
function toLines(items: RawItem[]): RawItem[][] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: RawItem[][] = [];
  for (const item of sorted) {
    const last = lines[lines.length - 1];
    const tolerance = Math.max(item.height * 0.6, 2);
    if (last && last[0] && Math.abs(last[0].y - item.y) <= tolerance) {
      last.push(item);
    } else {
      lines.push([item]);
    }
  }
  for (const line of lines) line.sort((a, b) => a.x - b.x);
  return lines;
}

export async function extractPdf(data: Uint8Array): Promise<ExtractedDocument> {
  const pdfjs = await getPdfJs();
  const loadingTask = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    // Silences noisy font warnings for the simple PDFs we deal with.
    verbosity: 0,
  });
  const doc = await loadingTask.promise;

  const pages: PageGeometry[] = [];
  const spans: TextSpan[] = [];
  let text = '';

  try {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({ page: pageNo, width: viewport.width, height: viewport.height });

      const content = await page.getTextContent();
      const items: RawItem[] = [];
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const [, , , , e, f] = item.transform as number[];
        items.push({
          text: item.str,
          x: e ?? 0,
          y: f ?? 0,
          width: item.width || 0,
          height: item.height || 0,
        });
      }

      for (const line of toLines(items)) {
        let lineText = '';
        const lineSpans: TextSpan[] = [];
        for (const item of line) {
          // pdf.js splits a visual line into runs; insert a space when the
          // previous run does not already end with one and there is a gap.
          const needsSpace =
            lineText.length > 0 && !/\s$/.test(lineText) && !/^\s/.test(item.text);
          if (needsSpace) lineText += ' ';
          lineSpans.push({
            page: pageNo,
            text: item.text,
            x: item.x,
            y: item.y,
            width: item.width,
            height: item.height || 10,
            offset: text.length + lineText.length,
          });
          lineText += item.text;
        }
        text += lineText + '\n';
        spans.push(...lineSpans);
      }
      text += '\n';
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }

  return { text: normaliseWhitespace(text), pages, spans };
}

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * Small layout helper for building the sample exam papers. Nothing here is used
 * at runtime by the grader - it exists so the fixtures are reproducible.
 */

export const A4: [number, number] = [595.28, 841.89];
export const MARGIN = 56;
export const INK = rgb(0.1, 0.12, 0.18);
export const PEN = rgb(0.11, 0.18, 0.45); // "blue pen" for student handwriting
export const GREY = rgb(0.45, 0.47, 0.52);
export const RULE = rgb(0.82, 0.84, 0.88);

export interface Fonts {
  body: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
  hand: PDFFont;
  handBold: PDFFont;
}

export async function createDoc(): Promise<{ doc: PDFDocument; fonts: Fonts }> {
  const doc = await PDFDocument.create();
  const fonts: Fonts = {
    body: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
    // Times reads as "handwriting" against the Helvetica printed form.
    hand: await doc.embedFont(StandardFonts.TimesRoman),
    handBold: await doc.embedFont(StandardFonts.TimesRomanBold),
  };
  return { doc, fonts };
}

/** pdf-lib's standard fonts are WinAnsi-encoded and throw on other codepoints. */
export function toWinAnsi(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/₹/g, 'Rs.')
    .replace(/→/g, '->')
    .replace(/[–]/g, '-')
    .replace(/−/g, '-');
}

export class Cursor {
  page: PDFPage;
  y: number;

  constructor(
    private doc: PDFDocument,
    private fonts: Fonts,
    /** Draws page furniture and returns the y the body text may start at. */
    private onNewPage?: (page: PDFPage, pageNumber: number) => number,
  ) {
    this.page = doc.addPage(A4);
    this.y = this.onNewPage?.(this.page, 1) ?? A4[1] - MARGIN;
  }

  get width(): number {
    return A4[0] - MARGIN * 2;
  }

  newPage(): void {
    this.page = this.doc.addPage(A4);
    this.y = this.onNewPage?.(this.page, this.doc.getPageCount()) ?? A4[1] - MARGIN;
  }

  space(amount: number): void {
    this.y -= amount;
  }

  ensure(height: number): void {
    if (this.y - height < MARGIN) this.newPage();
  }

  /** Draws one line of text at the current cursor and advances past it. */
  line(
    text: string,
    opts: {
      font?: PDFFont;
      size?: number;
      color?: ReturnType<typeof rgb>;
      indent?: number;
      leading?: number;
    } = {},
  ): void {
    const size = opts.size ?? 11;
    const leading = opts.leading ?? size * 1.45;
    this.ensure(leading);
    this.page.drawText(toWinAnsi(text), {
      x: MARGIN + (opts.indent ?? 0),
      y: this.y - size,
      size,
      font: opts.font ?? this.fonts.body,
      color: opts.color ?? INK,
    });
    this.y -= leading;
  }

  /** Word-wraps a paragraph to the text column. Returns the lines drawn. */
  paragraph(
    text: string,
    opts: {
      font?: PDFFont;
      size?: number;
      color?: ReturnType<typeof rgb>;
      indent?: number;
      leading?: number;
      width?: number;
    } = {},
  ): string[] {
    const font = opts.font ?? this.fonts.body;
    const size = opts.size ?? 11;
    const indent = opts.indent ?? 0;
    const maxWidth = (opts.width ?? this.width) - indent;
    const lines = wrap(toWinAnsi(text), font, size, maxWidth);
    for (const line of lines) {
      this.line(line, { ...opts, font, size });
    }
    return lines;
  }
}

export function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const out: string[] = [];
  for (const rawLine of text.split('\n')) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        out.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

export function ruledLines(page: PDFPage, top: number, bottom: number, gap = 26): void {
  for (let y = top; y > bottom; y -= gap) {
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: A4[0] - MARGIN, y },
      thickness: 0.5,
      color: RULE,
    });
  }
}

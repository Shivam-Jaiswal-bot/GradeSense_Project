import { rgb, type PDFPage } from 'pdf-lib';
import { MARGIN, PEN, toWinAnsi, type Fonts } from './pdfDraw.js';

/**
 * The figures are drawn as vectors with real text labels, so the labels land in
 * the PDF text layer. That is what lets the grader reason about the diagram and
 * lets an annotation be anchored to "Voltmeter (V) - in series after bulb".
 */

const LABEL = 8.5;

function label(page: PDFPage, fonts: Fonts, text: string, x: number, y: number, size = LABEL) {
  page.drawText(toWinAnsi(text), { x, y, size, font: fonts.hand, color: PEN });
}

function wire(page: PDFPage, x1: number, y1: number, x2: number, y2: number) {
  page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 1.1, color: PEN });
}

export type FigureStyle = 'flawed' | 'correct';

/**
 * Q1 circuit. The flawed drawing matches the student's wrong description - the
 * voltmeter sits in the main loop after the bulb, and no current direction is
 * marked. The correct drawing puts the voltmeter in a branch across the bulb
 * and labels the current direction, so the diagram and the prose agree.
 */
export function drawCircuit(
  page: PDFPage,
  fonts: Fonts,
  top: number,
  style: FigureStyle = 'flawed',
): number {
  const left = MARGIN + 30;
  const right = left + 330;
  const bottom = top - 150;
  const mid = (top + bottom) / 2;

  // Top rail: battery -> switch -> resistor
  wire(page, left, top, right, top);
  // Right rail down to the ammeter
  wire(page, right, top, right, mid + 14);
  wire(page, right, mid - 14, right, bottom);
  // Bottom rail: bulb then voltmeter (the student's series placement)
  wire(page, right, bottom, left, bottom);
  // Left rail back to the battery
  wire(page, left, bottom, left, top);

  // Battery
  const bx = left + 45;
  wire(page, bx, top + 9, bx, top - 9);
  wire(page, bx + 7, top + 5, bx + 7, top - 5);
  label(page, fonts, '+', bx - 4, top + 12);
  label(page, fonts, '-', bx + 10, top + 12);
  label(page, fonts, 'Battery', bx - 12, top - 22);

  // Switch - drawn open-ish, on the top rail
  const sx = left + 140;
  page.drawCircle({ x: sx, y: top, size: 1.8, color: PEN });
  page.drawCircle({ x: sx + 26, y: top, size: 1.8, color: PEN });
  wire(page, sx, top, sx + 22, top + 11);
  label(page, fonts, 'Switch', sx - 4, top - 22);

  // Resistor - zig-zag on the top rail
  const rx = left + 225;
  let zx = rx;
  let up = true;
  while (zx < rx + 48) {
    wire(page, zx, up ? top : top + 8, zx + 6, up ? top + 8 : top);
    zx += 6;
    up = !up;
  }
  label(page, fonts, 'Resistor (R)', rx - 4, top + 14);

  // Ammeter in series on the right rail - correct
  page.drawCircle({ x: right, y: mid, size: 14, borderColor: PEN, borderWidth: 1.1 });
  label(page, fonts, 'A', right - 3, mid - 3, 10);
  label(page, fonts, 'Ammeter (A) - in series', right + 18, mid - 3);

  // Bulb on the bottom rail
  const lx = left + 210;
  page.drawCircle({ x: lx, y: bottom, size: 13, borderColor: PEN, borderWidth: 1.1 });
  wire(page, lx - 9, bottom - 9, lx + 9, bottom + 9);
  wire(page, lx - 9, bottom + 9, lx + 9, bottom - 9);
  label(page, fonts, 'Bulb', lx - 8, bottom - 26);

  if (style === 'flawed') {
    // Voltmeter, also on the bottom rail - the intended error
    const vx = left + 110;
    page.drawCircle({ x: vx, y: bottom, size: 13, borderColor: PEN, borderWidth: 1.1 });
    label(page, fonts, 'V', vx - 3, bottom - 3, 10);
    label(page, fonts, 'Voltmeter (V) - in series after bulb', vx - 46, bottom - 26);
    return bottom - 46;
  }

  // Voltmeter in a branch across the bulb, and the current direction marked.
  const vy = bottom - 46;
  wire(page, lx - 26, bottom, lx - 26, vy);
  wire(page, lx + 26, bottom, lx + 26, vy);
  wire(page, lx - 26, vy, lx - 13, vy);
  wire(page, lx + 13, vy, lx + 26, vy);
  page.drawCircle({ x: lx, y: vy, size: 13, borderColor: PEN, borderWidth: 1.1 });
  label(page, fonts, 'V', lx - 3, vy - 3, 10);
  label(page, fonts, 'Voltmeter (V) - in parallel across bulb', lx - 50, vy - 24);
  label(page, fonts, 'Current direction ->', left + 60, top + 22);

  return vy - 44;
}

/**
 * Q3 demand/supply graph. The flawed drawing has the axes swapped to match the
 * student's prose - price on x, quantity on y - while the correct one puts
 * quantity on x and price on y.
 */
export function drawSupplyDemand(
  page: PDFPage,
  fonts: Fonts,
  top: number,
  style: FigureStyle = 'flawed',
): number {
  const x0 = MARGIN + 60;
  const y0 = top - 175;
  const w = 250;
  const h = 165;

  // Axes
  wire(page, x0, y0, x0 + w, y0);
  wire(page, x0, y0, x0, y0 + h);
  const flawed = style === 'flawed';
  label(
    page,
    fonts,
    flawed ? 'Price (Rs.) ->' : 'Quantity ->',
    x0 + w / 2 - 28,
    y0 - 28,
    9,
  );
  label(page, fonts, flawed ? 'Quantity' : 'Price (Rs.)', x0 - 52, y0 + h - 6, 9);

  // On the flawed graph price is the horizontal variable; on the correct one it
  // is the vertical one, and the two series swap axes with it.
  const prices = [10, 20, 30, 40, 50];
  prices.forEach((p, i) => {
    const along = ((i + 0.5) * w) / prices.length;
    if (flawed) {
      wire(page, x0 + along, y0, x0 + along, y0 - 3);
      label(page, fonts, String(p), x0 + along - 5, y0 - 13, 8);
    } else {
      const y = y0 + ((i + 0.5) * h) / prices.length;
      wire(page, x0 - 3, y, x0, y);
      label(page, fonts, String(p), x0 - 18, y - 3, 8);
    }
  });
  [20, 60, 100].forEach((q) => {
    if (flawed) {
      const y = y0 + (q / 110) * h;
      wire(page, x0 - 3, y, x0, y);
      label(page, fonts, String(q), x0 - 18, y - 3, 8);
    } else {
      const x = x0 + (q / 110) * w;
      wire(page, x, y0, x, y0 - 3);
      label(page, fonts, String(q), x - 7, y0 - 13, 8);
    }
  });

  // One point placement for both layouts: which axis carries price and which
  // carries quantity is the only thing that changes.
  const alongPrice = (i: number) => ((i + 0.5) * (flawed ? w : h)) / prices.length;
  const alongQuantity = (q: number) => (q / 110) * (flawed ? h : w);
  const point = (i: number, q: number) =>
    flawed
      ? { x: x0 + alongPrice(i), y: y0 + alongQuantity(q) }
      : { x: x0 + alongQuantity(q), y: y0 + alongPrice(i) };

  // Demand falls as price rises; supply rises with price.
  const demand = [100, 80, 60, 40, 20];
  const supply = [20, 40, 60, 80, 100];
  for (let i = 0; i < prices.length - 1; i++) {
    page.drawLine({
      start: point(i, demand[i]!),
      end: point(i + 1, demand[i + 1]!),
      thickness: 1.2,
      color: PEN,
    });
    page.drawLine({
      start: point(i, supply[i]!),
      end: point(i + 1, supply[i + 1]!),
      thickness: 1.2,
      color: rgb(0.15, 0.42, 0.24),
    });
  }
  const demandLabel = point(3, demand[3]!);
  const supplyLabel = point(3, supply[3]!);
  label(page, fonts, 'Demand', demandLabel.x + 6, demandLabel.y - 4);
  label(page, fonts, 'Supply', supplyLabel.x + 8, supplyLabel.y - 10);

  // Equilibrium marker at price 30 / quantity 60
  const equilibrium = point(2, 60);
  page.drawCircle({ x: equilibrium.x, y: equilibrium.y, size: 3, color: rgb(0.75, 0.15, 0.15) });
  label(
    page,
    fonts,
    'Equilibrium (Rs. 30, 60 units)',
    equilibrium.x + 8,
    equilibrium.y + (flawed ? 14 : -18),
  );

  return y0 - 34;
}

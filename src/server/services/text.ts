/** Shared text utilities: tokenising, OCR-tolerant matching, sentence splitting. */

const STOPWORDS = new Set(
  `a an the and or but if then than that this these those there their they them it its is are was
   were be been being do does did of to in on at by for with from as into about over under not no
   can could will would should may might must have has had he she his her you your we our i my me
   which who whom what when where how why so because also very more most much many some any each
   other same such only own too s t don now`.split(/\s+/),
);

/** Rubric boilerplate that carries no subject meaning. */
const RUBRIC_NOISE = new Set(
  `correct correctly correctness explain explains explained explanation identify identifies
   identified describe describes represent represents represented present presents provide
   provides provided use uses used demonstrate demonstrates recognise recognises recognises
   address addresses appropriate appropriately relevant relevantly clear clearly logical
   logically structured coherent overall communication answer answers student students marks mark
   including include includes point points question questions rather merely unsupported claims
   meaningfully main relationship tendency resulting change represented`.split(/\s+/),
);

export function splitSentences(text: string): string[] {
  return text
    // A line that ends without punctuation and is followed by a capital is a
    // heading or a diagram label, not part of the next sentence.
    .replace(/([^.!?:;,])\n(?=[A-Z(])/g, '$1. ')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+(?=[A-Z(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Very light suffix stripping - enough to match "increases" with "increase". */
export function stem(word: string): string {
  let w = word;
  for (const suffix of ['ing', 'edly', 'ely', 'ies', 'es', 'ed', 'ly', 's']) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length);
      if (suffix === 'ies') w += 'y';
      break;
    }
  }
  return w;
}

/**
 * Undoes the character confusions a scanner makes. "arnmeter" -> "ammeter",
 * "supp1y" -> "supply". This is what lets an OCR-damaged answer still be graded
 * on its content instead of being punished for the scan quality.
 */
export function ocrNormalise(word: string): string {
  return word
    .toLowerCase()
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/[1|]/g, 'l')
    .replace(/0/g, 'o')
    .replace(/5/g, 's')
    .replace(/8/g, 'b');
}

export function levenshtein(a: string, b: string, cap = 3): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      row.push(value);
      if (value < best) best = value;
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return prev[b.length]!;
}

/** How much distortion we tolerate before two words stop being the same word. */
function tolerance(word: string): number {
  if (word.length >= 8) return 2;
  if (word.length >= 5) return 1;
  return 0;
}

export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Content words, stemmed, with rubric boilerplate removed. */
export function significantTerms(text: string, extraNoise = RUBRIC_NOISE): Set<string> {
  const terms = new Set<string>();
  for (const word of wordsOf(text)) {
    if (word.length < 3) continue;
    if (STOPWORDS.has(word) || extraNoise.has(word)) continue;
    const stemmed = stem(ocrNormalise(word));
    if (stemmed.length >= 3 && !STOPWORDS.has(stemmed)) terms.add(stemmed);
  }
  return terms;
}

export interface TermIndex {
  has(term: string): boolean;
}

/**
 * Builds a lookup over a document's words that matches through OCR damage and
 * ordinary misspelling, so "resistence" still counts as "resistance".
 */
export function buildTermIndex(text: string): TermIndex {
  const exact = new Set<string>();
  const byLength = new Map<number, string[]>();
  for (const word of wordsOf(text)) {
    const normalised = stem(ocrNormalise(word));
    if (normalised.length < 3 || exact.has(normalised)) continue;
    exact.add(normalised);
    const bucket = byLength.get(normalised.length) ?? [];
    bucket.push(normalised);
    byLength.set(normalised.length, bucket);
  }

  return {
    has(term: string): boolean {
      if (exact.has(term)) return true;
      const allowed = tolerance(term);
      if (allowed === 0) return false;
      for (let len = term.length - allowed; len <= term.length + allowed; len++) {
        for (const candidate of byLength.get(len) ?? []) {
          if (levenshtein(term, candidate, allowed) <= allowed) return true;
        }
      }
      return false;
    },
  };
}

export function coverage(terms: Set<string>, index: TermIndex): number {
  if (terms.size === 0) return 0;
  let hits = 0;
  for (const term of terms) if (index.has(term)) hits++;
  return hits / terms.size;
}

/**
 * Polar word pairs. Comparing which member of a pair the student used against
 * which the model answer used is how the mock grader catches inversions -
 * "in series" for "in parallel", "surplus" for "shortage" - without needing to
 * know anything about circuits or economics.
 */
export interface PolarPair {
  a: string[];
  b: string[];
}

export const POLAR_PAIRS: PolarPair[] = [
  { a: ['series'], b: ['parallel'] },
  { a: ['increase'], b: ['decrease', 'reduce'] },
  { a: ['higher'], b: ['lower'] },
  { a: ['above'], b: ['below'] },
  { a: ['shortage'], b: ['surplus'] },
  { a: ['left', 'leftward'], b: ['right', 'rightward'] },
  { a: ['horizontal'], b: ['vertical'] },
  { a: ['upward'], b: ['downward'] },
];

const POLAR_LOOKUP = new Map<string, { pair: number; side: 0 | 1 }>();
POLAR_PAIRS.forEach(({ a, b }, pair) => {
  for (const word of a) register(word, pair, 0);
  for (const word of b) register(word, pair, 1);
});

/**
 * Registers every stem an inflection of a polar word can produce. The stemmer is
 * deliberately crude, so "increase" and "increased" reduce to different stems -
 * without both, an inversion between them is invisible.
 */
function register(word: string, pair: number, side: 0 | 1): void {
  for (const form of [word, `${word}s`, `${word}d`, `${word}ed`, `${word}ing`]) {
    POLAR_LOOKUP.set(stem(form), { pair, side });
  }
}

export function polarPairLabel(pair: number): string {
  const { a, b } = POLAR_PAIRS[pair]!;
  return `${a[0]}/${b[0]}`;
}

/** subject term -> polar pair -> which side of the pair was used about it. */
export type PolarAssociations = Map<string, Map<number, 0 | 1>>;

/** How far a polar word can reach for a subject inside its own clause. */
const POLAR_WINDOW = 6;

/**
 * Clause boundaries. A polar word belongs to its own clause: in "the resistance
 * is increased, the current decreases" the two halves must not be mixed, or
 * "current" ends up next to "increased" and the inversion is missed.
 */
const CLAUSE_SPLIT = /[,;:\u2022\u00b7|/]|\s+(?:and|but|so|because|while|whereas|although)\s+/i;

interface Token {
  raw: string;
  term: string;
  polar?: { pair: number; side: 0 | 1 };
}

/** Content words only - "in", "the", "is" must not push a subject out of range. */
function tokenise(clause: string): Token[] {
  const tokens: Token[] = [];
  for (const raw of wordsOf(clause)) {
    const term = stem(ocrNormalise(raw));
    const polar = POLAR_LOOKUP.get(term);
    if (!polar && (term.length < 3 || STOPWORDS.has(term) || STOPWORDS.has(raw))) continue;
    tokens.push({ raw, term, polar });
  }
  return tokens;
}

/**
 * A fragment with no polar word and almost no content ("a voltmeter", "however")
 * is not a clause of its own - it is the head or an aside of the next one.
 * Merging it back is what keeps "A voltmeter, however, should be connected in
 * parallel" readable as one statement about the voltmeter.
 */
function clausesOf(sentence: string): Token[][] {
  const raw = sentence.split(CLAUSE_SPLIT).map(tokenise).filter((c) => c.length > 0);
  const merged: Token[][] = [];
  let pending: Token[] = [];
  for (const clause of raw) {
    // Short polar-free fragments accumulate: "The bulb, resistor, battery,
    // switch and ammeter should be connected in series" is one list, not five
    // clauses, and every item in it is described by that one "series".
    if (!clause.some((t) => t.polar) && clause.length <= 2) {
      pending = pending.concat(clause);
      continue;
    }
    merged.push(pending.concat(clause));
    pending = [];
  }
  if (pending.length > 0) {
    if (merged.length > 0) merged[merged.length - 1]!.push(...pending);
    else merged.push(pending);
  }
  return merged;
}

/**
 * A subject is a content word that could be the thing being described. Verb and
 * adverb forms are dropped: they are how the clause is phrased, not what it is
 * about. Without that, "connected in parallel" produces feedback about
 * "connect" instead of about the voltmeter, and "Conversely, reducing the
 * resistance" hands the polarity to "conversely" while the resistance - the
 * thing that actually reduces - gets nothing.
 */
function isSubject(token: Token): boolean {
  return (
    token.term.length >= 3 &&
    !token.polar &&
    !STOPWORDS.has(token.term) &&
    !STOPWORDS.has(token.raw) &&
    !/(?:ing|ed|ly)$/.test(token.raw)
  );
}

/**
 * Ties each polar word in a sentence to the subject it is talking about.
 *
 * Each subject binds to the nearest polar word inside its own clause, so
 * "quantity on the horizontal axis and price on the vertical axis" yields
 * quantity->horizontal and price->vertical. Comparing those against the model
 * answer's is what separates swapped axes from correct ones; a sentence
 * containing both "horizontal" and "vertical" is unreadable without it.
 *
 * A subject that ends up on both sides of the same pair is dropped: the sentence
 * is genuinely ambiguous, and guessing there would invent errors.
 */
function subjectsIn(clause: Token[], from: number, step: -1 | 1): string[] {
  const found: string[] = [];
  for (let i = from, distance = 1; distance <= POLAR_WINDOW; i += step, distance++) {
    const token = clause[i];
    if (!token) break;
    if (isSubject(token)) found.push(token.term);
  }
  return found;
}

export function polarAssociations(sentence: string): PolarAssociations {
  const associations: PolarAssociations = new Map();
  const conflicted = new Set<string>();

  const bind = (subject: string, polar: { pair: number; side: 0 | 1 }): void => {
    if (conflicted.has(subject)) return;
    const forSubject = associations.get(subject) ?? new Map<number, 0 | 1>();
    const existing = forSubject.get(polar.pair);
    if (existing !== undefined && existing !== polar.side) {
      forSubject.delete(polar.pair);
      conflicted.add(subject);
      return;
    }
    forSubject.set(polar.pair, polar.side);
    associations.set(subject, forSubject);
  };

  for (const clause of clausesOf(sentence)) {
    clause.forEach((token, index) => {
      if (!token.polar) return;

      // A polar word describes what came before it: in "connected in parallel
      // across the bulb" it is the voltmeter that is parallel, not the bulb.
      // Only when nothing precedes it does it look forward, which is the
      // "lower quantity" shape where the adjective leads.
      let subjects = subjectsIn(clause, index - 1, -1);
      if (subjects.length === 0) subjects = subjectsIn(clause, index + 1, 1);
      for (const subject of subjects) bind(subject, token.polar);
    });
  }

  return associations;
}

/**
 * Folds several sentences' associations into one reference, dropping any
 * subject/pair the sentences disagree about.
 *
 * The model answer says both "below the equilibrium price ... shortage" and
 * "above the equilibrium price ... surplus". Read one sentence at a time, a
 * correct student answer looks inverted against whichever sentence it did not
 * echo. Folded together, the disagreement cancels and only what the marking
 * scheme says consistently is left to grade against.
 */
export function mergeAssociations(sentences: string[]): PolarAssociations {
  const merged: PolarAssociations = new Map();
  const conflicted = new Set<string>();

  for (const sentence of sentences) {
    for (const [subject, pairs] of polarAssociations(sentence)) {
      if (conflicted.has(subject)) continue;
      const forSubject = merged.get(subject) ?? new Map<number, 0 | 1>();
      for (const [pair, side] of pairs) {
        const existing = forSubject.get(pair);
        if (existing !== undefined && existing !== side) forSubject.delete(pair);
        else forSubject.set(pair, side);
      }
      merged.set(subject, forSubject);
    }
  }
  return merged;
}

/** pair combination ("3:4") -> the side combinations seen for it ("10", "01"). */
export type PolarLinks = Map<string, Set<string>>;

/**
 * Records which polar words are used *together*. "Shortage below equilibrium,
 * surplus above equilibrium" is not a claim about a subject - it is a claim
 * about which pair goes with which. A student who writes "above ... shortage"
 * uses both words the marking scheme uses and every subject correctly; only the
 * combination is wrong, and nothing else here can see that.
 */
export function polarLinks(text: string): PolarLinks {
  const links: PolarLinks = new Map();
  for (const sentence of splitSentences(text)) {
    for (const clause of clausesOf(sentence)) {
      const all = clause.flatMap((token) => (token.polar ? [token.polar] : []));
      // "from left to right" uses both sides of a pair as one phrase; it states
      // no direction, and reading it as one invents disagreements.
      const ambiguous = new Set(
        all.filter((p) => all.some((other) => other.pair === p.pair && other.side !== p.side))
          .map((p) => p.pair),
      );
      const polars = all.filter((p) => !ambiguous.has(p.pair));
      for (let i = 0; i < polars.length; i++) {
        for (let j = i + 1; j < polars.length; j++) {
          const [first, second] = polars[i]!.pair < polars[j]!.pair
            ? [polars[i]!, polars[j]!]
            : [polars[j]!, polars[i]!];
          if (first.pair === second.pair) continue;
          const key = `${first.pair}:${second.pair}`;
          const combination = `${first.side}${second.side}`;
          links.set(key, (links.get(key) ?? new Set<string>()).add(combination));
        }
      }
    }
  }
  return links;
}

/** Spells out a link combination for feedback: `"above" with "shortage"`. */
export function describeLink(key: string, combination: string): string {
  const [first, second] = key.split(':').map(Number) as [number, number];
  const sideA = Number(combination[0]) as 0 | 1;
  const sideB = Number(combination[1]) as 0 | 1;
  const wordA = sideA === 0 ? POLAR_PAIRS[first]!.a[0] : POLAR_PAIRS[first]!.b[0];
  const wordB = sideB === 0 ? POLAR_PAIRS[second]!.a[0] : POLAR_PAIRS[second]!.b[0];
  return `"${wordA}" with "${wordB}"`;
}

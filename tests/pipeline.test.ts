/** The pieces the grading depends on: rubric parsing, anchoring, validation. */

import { describe, expect, it } from 'vitest';
import { locate, rectsForRange } from '../src/server/services/anchor.js';
import { buildAnnotations } from '../src/server/services/annotations.js';
import { segmentAnswers } from '../src/server/services/segment.js';
import { ocrNormalise, polarAssociations, polarLinks } from '../src/server/services/text.js';
import { validateQuestion } from '../src/server/services/validate.js';
import type { GradingRun } from '../src/shared/types.js';
import { answer, loadRubric } from './helpers.js';

describe('rubric parsing', () => {
  it('reads the marking scheme out of the model answer without an LLM', async () => {
    const { rubric, warnings } = await loadRubric();

    expect(warnings).toEqual([]);
    expect(rubric.maxMarks).toBe(15);
    expect(rubric.questions).toHaveLength(3);
    expect(rubric.questions.flatMap((q) => q.criteria)).toHaveLength(15);

    for (const question of rubric.questions) {
      expect(question.prompt.length).toBeGreaterThan(10);
      expect(question.modelAnswer.length).toBeGreaterThan(50);
      expect(question.criteria.reduce((sum, c) => sum + c.maxMarks, 0)).toBe(question.maxMarks);
    }
  });
});

describe('answer segmentation', () => {
  it('splits the paper into the three answers', async () => {
    const [{ rubric }, paper] = await Promise.all([loadRubric(), answer('planted')]);
    const { blocks, warnings } = segmentAnswers(paper.text, rubric.questions);

    expect(warnings).toEqual([]);
    expect([...blocks.keys()].sort()).toEqual(['q1', 'q2', 'q3']);
    expect(blocks.get('q1')!.text).toMatch(/circut/i);
    expect(blocks.get('q2')!.text).toMatch(/technology/i);
    expect(blocks.get('q3')!.text).toMatch(/equilibrium/i);
  });
});

describe('evidence anchoring', () => {
  it('finds a quote and reports where it sits on the page', async () => {
    const paper = await answer('planted');
    const quote = 'The voltmeter is also connected in series';
    const found = locate(quote, paper.text);

    expect(found).not.toBeNull();
    const rects = rectsForRange(found!, paper.spans);
    expect(rects.length).toBeGreaterThan(0);
    expect(rects[0]!.page).toBeGreaterThanOrEqual(1);
    expect(rects[0]!.width).toBeGreaterThan(0);
  });

  it('tolerates OCR damage in the quote', async () => {
    const paper = await answer('ocr');
    // "arnmeter" in the paper, spelled properly in the quote.
    expect(locate('ammeter are connected in series', paper.text)).not.toBeNull();
  });

  it('refuses to guess when the quote is not in the paper', async () => {
    const paper = await answer('planted');
    expect(locate('the mitochondria is the powerhouse of the cell', paper.text)).toBeNull();
  });
});

describe('output validation', () => {
  const criterion = { id: 'q1.c1', description: 'Something', maxMarks: 1 };
  const documentText = 'The battery drives the current around the loop.';
  const context = {
    question: {
      id: 'q1',
      number: 1,
      subject: 'Science',
      prompt: 'p',
      maxMarks: 1,
      modelAnswer: 'model',
      criteria: [criterion],
    },
    block: { questionId: 'q1', text: documentText, start: 0, end: documentText.length, located: true },
    documentText,
    spans: [],
  };

  it('clamps marks above the maximum and records the change', () => {
    const result = validateQuestion(
      {
        questionId: 'q1',
        criteria: [
          {
            criterionId: 'q1.c1',
            awardedMarks: 7,
            status: 'correct',
            evidence: ['The battery drives the current'],
            feedback: 'ok',
            correction: '',
            confidence: 0.9,
          },
        ],
        issues: [],
        summary: 's',
      },
      context,
    );

    expect(result.result.criteria[0]!.awardedMarks).toBe(1);
    expect(result.result.awardedMarks).toBe(1);
    expect(result.adjustments.join(' ')).toMatch(/maximum|clamp/i);
  });

  it('drops evidence that is not in the student answer', () => {
    const result = validateQuestion(
      {
        questionId: 'q1',
        criteria: [
          {
            criterionId: 'q1.c1',
            awardedMarks: 1,
            status: 'correct',
            evidence: ['a sentence the student never wrote'],
            feedback: 'ok',
            correction: '',
            confidence: 0.95,
          },
        ],
        issues: [],
        summary: 's',
      },
      context,
    );

    const graded = result.result.criteria[0]!;
    expect(graded.evidence).toHaveLength(0);
    // A mark with no verifiable support cannot be reported confidently.
    expect(graded.confidence).toBeLessThanOrEqual(0.35);
    expect(result.adjustments.length).toBeGreaterThan(0);
  });

  it('never returns a negative mark', () => {
    const result = validateQuestion(
      {
        questionId: 'q1',
        criteria: [
          {
            criterionId: 'q1.c1',
            awardedMarks: -4,
            status: 'incorrect',
            evidence: [],
            feedback: 'bad',
            correction: '',
            confidence: 0.5,
          },
        ],
        issues: [],
        summary: 's',
      },
      context,
    );
    expect(result.result.criteria[0]!.awardedMarks).toBe(0);
  });
});

describe('polarity reading', () => {
  it('ties a polar word to the thing it describes, not to the nearest verb', () => {
    const model = polarAssociations('A voltmeter should be connected in parallel across the bulb.');
    expect(model.get('voltmeter')?.size).toBe(1);

    const student = polarAssociations('The voltmeter is connected in series after the bulb.');
    const pair = [...model.get('voltmeter')!.keys()][0]!;
    expect(student.get('voltmeter')?.get(pair)).not.toBe(model.get('voltmeter')!.get(pair));
  });

  it('reads "from left to right" as a phrase, not as a claim about direction', () => {
    expect(polarLinks('The demand curve slopes downward from left to right.').size).toBe(0);
  });

  it('spots a swapped pairing of two ideas', () => {
    const scheme = polarLinks('Shortage below equilibrium, surplus above equilibrium.');
    const wrong = polarLinks('If the price goes above the equilibrium there will be a shortage.');
    const [key, combinations] = [...wrong][0]!;
    expect(scheme.has(key)).toBe(true);
    expect(scheme.get(key)!.has([...combinations][0]!)).toBe(false);
  });

  it('undoes the character confusions a scanner makes', () => {
    expect(ocrNormalise('arnmeter')).toBe('ammeter');
    expect(ocrNormalise('supp1y')).toBe('supply');
  });
});

describe('annotations', () => {
  it('places a mark on the words it is about and parks the rest in the margin', async () => {
    const paper = await answer('planted');
    const quote = 'The voltmeter is also connected in series';
    const run: GradingRun = {
      id: 'run',
      createdAt: new Date().toISOString(),
      studentDocumentId: 'doc',
      studentName: null,
      questionPaperId: null,
      modelAnswerId: null,
      maxMarks: 1,
      awardedMarks: 0,
      confidence: 0.5,
      needsHumanReview: true,
      reviewReasons: [],
      provider: 'mock',
      model: 'test',
      adjustments: [],
      degraded: false,
      durationMs: 1,
      questions: [
        {
          questionId: 'q1',
          number: 1,
          subject: 'Science',
          maxMarks: 1,
          awardedMarks: 0,
          criteria: [],
          summary: '',
          confidence: 0.5,
          issues: [
            {
              id: 'i1',
              questionId: 'q1',
              criterionId: 'q1.c2',
              type: 'wrong_reasoning',
              quote,
              correction: 'in parallel across the bulb',
              comment: 'wrong placement',
              marksLost: 1,
              confidence: 0.7,
            },
            {
              id: 'i2',
              questionId: 'q1',
              criterionId: 'q1.c3',
              type: 'missing_point',
              quote: '',
              correction: 'say something about the current direction',
              comment: 'not addressed',
              marksLost: 1,
              confidence: 0.5,
            },
          ],
        },
      ],
    };

    const annotations = buildAnnotations({
      run,
      documentText: paper.text,
      spans: paper.spans,
      pages: paper.pages,
    });

    expect(annotations).toHaveLength(2);
    const [anchored, parked] = annotations;
    expect(anchored!.anchored).toBe(true);
    expect(anchored!.width).toBeGreaterThan(10);
    expect(parked!.anchored).toBe(false);
    expect(parked!.style).toBe('note');
  });
});

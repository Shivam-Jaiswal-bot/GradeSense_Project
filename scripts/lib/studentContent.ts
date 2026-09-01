/**
 * The authored student answer and its error key, in one place so that
 * fixtures/error-key.md can never drift from fixtures/student-answer.pdf.
 *
 * The answer is deliberately "difficult but believable": the writing is fluent
 * and mostly on-topic, the mistakes are the kind a real student makes, and two
 * of them (voltmeter in series, shortage/surplus swapped) are substantive
 * errors that a grader keying on surface similarity would happily miss.
 */

export interface IntendedError {
  id: string;
  questionId: string;
  /** Rubric criterion the mistake is aimed at, or null for surface errors. */
  criterionId: string | null;
  type:
    | 'missing_point'
    | 'wrong_reasoning'
    | 'factual_error'
    | 'spelling'
    | 'grammar'
    | 'layout';
  /** Verbatim text from the answer, so it can be located on the page. */
  quote: string;
  correction: string;
  note: string;
}

export interface AnswerParagraph {
  text: string;
  /** Extra left indent in points - used to create the alignment defects. */
  indent?: number;
}

export interface AnswerQuestion {
  id: string;
  heading: string;
  paragraphs: AnswerParagraph[];
  figure?: 'circuit' | 'supplyDemand';
  /** 'flawed' (default) draws the diagram the student actually drew. */
  figureStyle?: 'flawed' | 'correct';
  /** Caption offset in points; a large value pushes it past the right margin. */
  captionOffset?: number;
  caption?: string;
}

export const STUDENT_HEADER = {
  name: 'Ananya Sharma',
  roll: 'Roll No. 24-1187',
  className: 'Class X - Section B',
  paper: 'GradeSense Assessment - Answer Sheet',
};

export const STUDENT_ANSWER: AnswerQuestion[] = [
  {
    id: 'q1',
    heading: 'Answer 1. (Science)',
    figure: 'circuit',
    caption: 'Fig. 1 - Circut diagram of a simple electric circuit',
    captionOffset: 300,
    paragraphs: [
      {
        text: 'A simple electric circut is a closed path which allows the current to flow through it. The battery is the source of energy and it provides the potential difference which pushes the current around the loop. The switch is used to open and close the circut. When the switch is closed the path is complete and current flows through the bulb and the resistor, and when the switch is open the path is broken so no current can flow.',
      },
      {
        text: 'In my circuit the battery, the switch, the resistor, the bulb and the ammeter are all joined one after the other in series. The ammeter is connected in series because it has to measure the current that is passing through the circuit. The voltmeter is also connected in series, just after the bulb, so that it can measure the voltage of the bulb.',
      },
      {
        text: 'The current comes out from the positive terminal of the battery, goes through all the components of the outside circuit and returns back into the negative terminal.',
      },
      {
        text: 'The resistance decides how much current will flow in the circuit. If we increase the resistence then the current also increases, because a bigger resistor pushes more current through the wire. This is the reason a rheostat is used when we want to make the bulb glow brighter.',
      },
    ],
  },
  {
    id: 'q2',
    heading: 'Answer 2. (English)',
    paragraphs: [
      {
        text: 'In todays world technology have made information very easy to get. Anything a student wants to know is available on the internet within a few seconds. I believe that technology is making students more dependent on ready made answers instead of making them better learners.',
      },
      {
        text: 'Earlier a student had to read the whole chapter and think about the question properly before writing the answer. Now most students simply search the question on their phone and copy the first answer that comes. Because of this they finish there homework very fast but they do not remember anything after a few days. For example, many students now use a calculator even for very small sums, and later they cannot do a simple multiplication in there head. Some people say that technology is good because it gives more information.',
        indent: 34,
      },
      {
        text: 'Therefore technology is a very useful thing for students and it definitely makes them better learners, so every student should use it as much as possible.',
      },
    ],
  },
  {
    id: 'q3',
    heading: 'Answer 3. (Economics)',
    figure: 'supplyDemand',
    caption: 'Fig. 2 - Demand and supply graph',
    paragraphs: [
      {
        text: 'The table shows how much quantity is demanded and how much is supplied at each different price. I have drawn the graph below by taking price on the horizontal axis and quantity on the vertical axis.',
      },
      {
        text: 'The demand curve slopes downward because when the price is low the buyers want to buy a larger quantity, and the supply curve slopes upward because the sellers are willing to sell more when the price is high. The two lines cut each other at the price of Rs. 30 and the quantity of 60 units. This is the equilibrium point of the market, because at this price the quantity demanded is exactly equal to the quantity supplied.',
      },
      {
        text: 'If the price in the market goes above the equilibrium price then there will be a shortage in the market, because the buyers will demand much more than what the sellers are ready to supply. In the same way, if the price falls below the equilibrium price there will be a surplus of goods lying unsold with the sellers.',
      },
      {
        text: 'If the cost of production increases then the producers will not be able to supply the same quantity at the old price, so the supply curve shifts to the left. The new equilibrium will then be at a higher price and also at a higher quantity, because when the price has gone up the sellers will sell more.',
      },
    ],
  },
];

export const ERROR_KEY: IntendedError[] = [
  {
    id: 'E1',
    questionId: 'q1',
    criterionId: 'q1.c2',
    type: 'factual_error',
    quote: 'The voltmeter is also connected in series, just after the bulb',
    correction:
      'The voltmeter must be connected in parallel across the bulb, because it measures the potential difference between the two ends of the bulb.',
    note: 'Substantive error. The model answer names this exact mistake as one that must cost the rubric mark.',
  },
  {
    id: 'E2',
    questionId: 'q1',
    criterionId: 'q1.c4',
    type: 'wrong_reasoning',
    quote:
      'If we increase the resistence then the current also increases, because a bigger resistor pushes more current through the wire',
    correction:
      'If the resistance increases while the voltage stays constant, the current decreases (V = IR). A resistor opposes current, it does not push it.',
    note: 'Inverts Ohm\'s law and gives a confident but wrong justification.',
  },
  {
    id: 'E3',
    questionId: 'q1',
    criterionId: 'q1.c5',
    type: 'missing_point',
    quote: '',
    correction:
      'The diagram should be labelled with the direction of conventional current, from the positive terminal through the external circuit to the negative terminal.',
    note: 'The direction is stated in the prose but never marked on the diagram, so the labelling mark is only partly earned.',
  },
  {
    id: 'E4',
    questionId: 'q1',
    criterionId: null,
    type: 'spelling',
    quote: 'circut',
    correction: 'circuit',
    note: 'Appears twice in the first paragraph and once in the figure caption.',
  },
  {
    id: 'E5',
    questionId: 'q1',
    criterionId: null,
    type: 'spelling',
    quote: 'resistence',
    correction: 'resistance',
    note: 'OCR-plausible vowel substitution.',
  },
  {
    id: 'E6',
    questionId: 'q1',
    criterionId: null,
    type: 'layout',
    quote: 'Fig. 1 - Circut diagram of a simple electric circuit',
    correction:
      'The caption should sit under the figure inside the text column, not overflow the right margin.',
    note: 'Alignment defect: the caption is pushed out of the writing area.',
  },
  {
    id: 'E7',
    questionId: 'q2',
    criterionId: null,
    type: 'grammar',
    quote: 'In todays world technology have made information very easy to get',
    correction: "In today's world technology has made information very easy to get.",
    note: 'Missing possessive apostrophe and subject-verb disagreement in the opening line.',
  },
  {
    id: 'E8',
    questionId: 'q2',
    criterionId: null,
    type: 'grammar',
    quote: 'they finish there homework very fast',
    correction: 'they finish their homework very fast',
    note: '"there" for "their". The same confusion is repeated later in the paragraph.',
  },
  {
    id: 'E9',
    questionId: 'q2',
    criterionId: 'q2.c3',
    type: 'missing_point',
    quote: 'Some people say that technology is good because it gives more information.',
    correction:
      'The opposing view is named but never answered. It needs a response, e.g. that more information only helps when the student evaluates it rather than copying it.',
    note: 'Counter-argument raised in a single trailing sentence and then dropped.',
  },
  {
    id: 'E10',
    questionId: 'q2',
    criterionId: 'q2.c5',
    type: 'wrong_reasoning',
    quote:
      'Therefore technology is a very useful thing for students and it definitely makes them better learners, so every student should use it as much as possible.',
    correction:
      'The conclusion must follow from the argument. The essay argued that technology creates dependence, so the conclusion should be a qualified one, e.g. that technology helps only when it is used to support thinking rather than replace it.',
    note: 'The conclusion directly contradicts the position stated in paragraph 1.',
  },
  {
    id: 'E11',
    questionId: 'q2',
    criterionId: null,
    type: 'layout',
    quote: 'Earlier a student had to read the whole chapter',
    correction: 'The paragraph should be aligned with the rest of the answer.',
    note: 'The middle paragraph is indented well past the left margin of the other paragraphs.',
  },
  {
    id: 'E12',
    questionId: 'q3',
    criterionId: 'q3.c1',
    type: 'factual_error',
    quote: 'taking price on the horizontal axis and quantity on the vertical axis',
    correction:
      'Quantity goes on the horizontal axis and price on the vertical axis. The graph is drawn with the axes swapped.',
    note: 'The prose and the drawn figure agree with each other, so the error is consistent and easy to miss.',
  },
  {
    id: 'E13',
    questionId: 'q3',
    criterionId: 'q3.c3',
    type: 'wrong_reasoning',
    quote:
      'If the price in the market goes above the equilibrium price then there will be a shortage in the market',
    correction:
      'A price above equilibrium produces a surplus (supply exceeds demand); a price below equilibrium produces a shortage. The two are swapped.',
    note: 'Both halves of the paragraph are inverted, and both are stated confidently.',
  },
  {
    id: 'E14',
    questionId: 'q3',
    criterionId: 'q3.c5',
    type: 'factual_error',
    quote: 'The new equilibrium will then be at a higher price and also at a higher quantity',
    correction:
      'A leftward shift of supply gives a higher equilibrium price and a lower equilibrium quantity.',
    note: 'The first half is right, so the mark hinges on the grader reading the whole claim.',
  },
];

/** Points the answer gets right - used in the error key to show the contrast. */
export const CORRECT_POINTS: { questionId: string; criterionId: string; note: string }[] = [
  {
    questionId: 'q1',
    criterionId: 'q1.c1',
    note: 'Battery, switch, resistor, bulb and ammeter correctly described as a closed series loop.',
  },
  {
    questionId: 'q1',
    criterionId: 'q1.c3',
    note: 'Function of the battery, switch and the current path are explained correctly.',
  },
  {
    questionId: 'q2',
    criterionId: 'q2.c1',
    note: 'States a clear position in the first paragraph.',
  },
  {
    questionId: 'q2',
    criterionId: 'q2.c4',
    note: 'Uses a concrete, relevant example (calculator dependence).',
  },
  {
    questionId: 'q3',
    criterionId: 'q3.c2',
    note: 'Identifies equilibrium at Rs. 30 / 60 units and explains why it is the equilibrium.',
  },
  {
    questionId: 'q3',
    criterionId: 'q3.c4',
    note: 'Correctly says a rise in production cost shifts the supply curve to the left.',
  },
];

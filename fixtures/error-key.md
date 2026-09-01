# Error key - `fixtures/student-answer.pdf`

Student: **Ananya Sharma**, Roll No. 24-1187.

Every mistake below was placed deliberately. This file is generated from
`scripts/lib/studentContent.ts`, the same source the answer PDF is rendered
from, so the key cannot drift from the paper.

**14 intended mistakes** across three answers: 
3 factual, 3 wrong reasoning, 2 missing points, 2 spelling, 2 grammar, 2 layout.

## Q1 - Science (5 marks)

| # | Type | Rubric | What the answer says | What it should say |
| --- | --- | --- | --- | --- |
| E1 | factual error | q1.c2 | "The voltmeter is also connected in series, just after the bulb" | The voltmeter must be connected in parallel across the bulb, because it measures the potential difference between the two ends of the bulb. |
| E2 | wrong reasoning | q1.c4 | "If we increase the resistence then the current also increases, because a bigger resistor pushes more current through the wire" | If the resistance increases while the voltage stays constant, the current decreases (V = IR). A resistor opposes current, it does not push it. |
| E3 | missing point | q1.c5 | _(nothing written)_ | The diagram should be labelled with the direction of conventional current, from the positive terminal through the external circuit to the negative terminal. |
| E4 | spelling | - | "circut" | circuit |
| E5 | spelling | - | "resistence" | resistance |
| E6 | layout | - | "Fig. 1 - Circut diagram of a simple electric circuit" | The caption should sit under the figure inside the text column, not overflow the right margin. |

Notes:

- **E1** - Substantive error. The model answer names this exact mistake as one that must cost the rubric mark.
- **E2** - Inverts Ohm's law and gives a confident but wrong justification.
- **E3** - The direction is stated in the prose but never marked on the diagram, so the labelling mark is only partly earned.
- **E4** - Appears twice in the first paragraph and once in the figure caption.
- **E5** - OCR-plausible vowel substitution.
- **E6** - Alignment defect: the caption is pushed out of the writing area.

Points the answer earns:

- `q1.c1` - Battery, switch, resistor, bulb and ammeter correctly described as a closed series loop.
- `q1.c3` - Function of the battery, switch and the current path are explained correctly.

## Q2 - English (5 marks)

| # | Type | Rubric | What the answer says | What it should say |
| --- | --- | --- | --- | --- |
| E7 | grammar | - | "In todays world technology have made information very easy to get" | In today's world technology has made information very easy to get. |
| E8 | grammar | - | "they finish there homework very fast" | they finish their homework very fast |
| E9 | missing point | q2.c3 | "Some people say that technology is good because it gives more information." | The opposing view is named but never answered. It needs a response, e.g. that more information only helps when the student evaluates it rather than copying it. |
| E10 | wrong reasoning | q2.c5 | "Therefore technology is a very useful thing for students and it definitely makes them better learners, so every student should use it as much as possible." | The conclusion must follow from the argument. The essay argued that technology creates dependence, so the conclusion should be a qualified one, e.g. that technology helps only when it is used to support thinking rather than replace it. |
| E11 | layout | - | "Earlier a student had to read the whole chapter" | The paragraph should be aligned with the rest of the answer. |

Notes:

- **E7** - Missing possessive apostrophe and subject-verb disagreement in the opening line.
- **E8** - "there" for "their". The same confusion is repeated later in the paragraph.
- **E9** - Counter-argument raised in a single trailing sentence and then dropped.
- **E10** - The conclusion directly contradicts the position stated in paragraph 1.
- **E11** - The middle paragraph is indented well past the left margin of the other paragraphs.

Points the answer earns:

- `q2.c1` - States a clear position in the first paragraph.
- `q2.c4` - Uses a concrete, relevant example (calculator dependence).

## Q3 - Economics (5 marks)

| # | Type | Rubric | What the answer says | What it should say |
| --- | --- | --- | --- | --- |
| E12 | factual error | q3.c1 | "taking price on the horizontal axis and quantity on the vertical axis" | Quantity goes on the horizontal axis and price on the vertical axis. The graph is drawn with the axes swapped. |
| E13 | wrong reasoning | q3.c3 | "If the price in the market goes above the equilibrium price then there will be a shortage in the market" | A price above equilibrium produces a surplus (supply exceeds demand); a price below equilibrium produces a shortage. The two are swapped. |
| E14 | factual error | q3.c5 | "The new equilibrium will then be at a higher price and also at a higher quantity" | A leftward shift of supply gives a higher equilibrium price and a lower equilibrium quantity. |

Notes:

- **E12** - The prose and the drawn figure agree with each other, so the error is consistent and easy to miss.
- **E13** - Both halves of the paragraph are inverted, and both are stated confidently.
- **E14** - The first half is right, so the mark hinges on the grader reading the whole claim.

Points the answer earns:

- `q3.c2` - Identifies equilibrium at Rs. 30 / 60 units and explains why it is the equilibrium.
- `q3.c4` - Correctly says a rise in production cost shifts the supply curve to the left.

## Expected shape of a correct grading

Six of the fifteen rubric criteria are clearly earned and six are clearly
lost, with `q1.c5` (labelling and structure) a partial. A grader that scores
this paper in the 6-9 range, and that names the voltmeter placement, the
inverted Ohm's law reasoning, the swapped axes, the swapped shortage/surplus
and the self-contradicting conclusion, is reading the answer rather than
matching it against the model answer.

## Other fixtures

| File | Purpose |
| --- | --- |
| `student-answer-correct.pdf` | A near-model answer. Should score at or near 15/15. |
| `student-answer-incorrect.pdf` | Confidently wrong throughout. Should score at or near 0. |
| `student-answer-blank.pdf` | Nothing written. Must score 0 and be flagged for review, not guessed at. |
| `student-answer-ocr.pdf` | The correct answer with OCR-style corruption. Should still score high. |
| `answer-sheet-template.pdf` | The blank sheet the answers are written on. |

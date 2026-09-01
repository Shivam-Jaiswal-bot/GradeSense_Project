# GradeSense

A grading and annotation tool for scanned exam answer papers. It reads the
question paper, the model answer and a student's answer, awards marks against
each rubric point, explains every mark with the student's own words, draws the
mistakes on the page, and exports an annotated copy — leaving the original
untouched.

The two things it refuses to do are guess and drift: a mark is never given for
a quote that is not in the paper, the total is always the sum of the rubric
points, and moving an annotation never re-grades anything.

---

## Setup

Requires **Node 20.10+**.

```bash
npm install
cp .env.example .env      # optional; the tool runs without it
npm run dev               # API on :4000, UI on http://localhost:5173
```

Open <http://localhost:5173>, upload the three PDFs and press **Grade paper**.
Ready-made papers to try:

| File | What it is |
| --- | --- |
| `Product_Requirements_Details/GradeSense QP.pdf` | question paper |
| `Product_Requirements_Details/GradeSense MA.pdf` | model answer / rubric |
| `fixtures/student-answer.pdf` | the student answer written for this exercise, with 14 deliberate mistakes |

### Grading model

Grading is pluggable and configured entirely by environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | _(unset)_ | Anthropic key. **Never commit this**; `.env` is gitignored. |
| `GRADESENSE_PROVIDER` | auto | `anthropic` or `mock`. Unset means "Anthropic if a key is present, otherwise mock". |
| `GRADESENSE_MODEL` | `claude-sonnet-5` | Model id for the Anthropic provider. |
| `PORT` | `4000` | API port. |
| `GRADESENSE_DB` | `data/gradesense.db` | SQLite file. |

**With a key**, Claude grades each question and every answer it returns is
validated, clamped and evidence-checked before anything reaches the screen.
**Without a key**, a deterministic offline grader takes over, so the app, the
demo and the whole test suite run with no network and no credentials. The
offline grader is honest about being shallow: it reports low confidence on the
rubric points it cannot judge, and those flow through to the human-review flag.

### Other commands

```bash
npm test          # the full suite (no network, no key needed)
npm run typecheck # server + client
npm run build     # compile the server and bundle the client
npm start         # serve the built app on :4000
npm run papers    # regenerate the sample answer papers and the error key
npm run example   # grade fixtures/student-answer.pdf -> fixtures/example-annotated-answer.pdf
```

---

## What it produces

For every rubric point:

- marks awarded out of the marks available, and the total for the question
- a status: correct / partial / missing / incorrect
- **evidence** — the student's exact words, located to a rectangle on the page
- what is missing or wrong, and what the answer should have said
- a confidence value

For the paper as a whole: the total, an overall confidence, a
**needs-human-review** flag with the reasons in plain English, and a list of
every automatic correction that had to be applied to the model's output.

Annotations are drawn from the mistakes and then live independently. In the UI
you can drag them, resize them, retype the comment, change the style, delete
them, and Alt-click a page to add your own. None of that touches the marks.
**Download annotated PDF** writes a new file: the original pages with numbered
marks, plus an appended examiner's report listing the breakdown, the evidence
and every comment.

---

## Deliverables in this repo

| Path | What it is |
| --- | --- |
| `fixtures/student-answer.pdf` | the student answer written for this task (1–2 pages, mixed correct and wrong) |
| `fixtures/error-key.md` | the error key: every planted mistake, its rubric point and its correct version |
| `fixtures/example-annotated-answer.pdf` | an example annotated output |
| `fixtures/example-annotated-answer.json` | the grading result behind it |
| `fixtures/student-answer-{correct,incorrect,ocr,blank}.pdf` | variants used by the tests |
| `docs/ARCHITECTURE.md` | how it works and why it is built this way |
| `docs/TEST-OUTPUT.md` | the test run output |

### The sample answer

`fixtures/student-answer.pdf` is generated from `scripts/lib/studentContent.ts`
by `npm run papers`. That single file is also the source of `error-key.md`, so
the paper and the key cannot disagree. It contains 14 deliberate mistakes: 3
factual errors, 3 pieces of wrong reasoning, 2 missing points, 2 spelling
errors, 2 grammar errors and 2 layout defects — including a circuit diagram
that agrees with the student's wrong prose and a demand/supply graph with the
axes swapped.

---

## Tests

`npm test` covers the eight required scenarios plus the machinery underneath:

| Scenario | Test |
| --- | --- |
| Fully correct answer | `tests/grading.test.ts` |
| Partially correct answer | ” |
| Incorrect answer | ” |
| Blank answer | ” |
| OCR-style spelling errors | ” |
| Malformed model output | ” |
| Model / API failure | ” |
| Score above the maximum | ” |
| Rubric parsing, segmentation, anchoring, validation, polarity reading, annotation placement | `tests/pipeline.test.ts` |
| Upload → grade → edit annotations → export, over HTTP | `tests/api.test.ts` |

Two invariants are asserted on *every* grading test, whatever the model
returned: the totals reconcile exactly (criteria → question → paper, never
above the maximum), and every quote handed back really appears in the paper.

---

## Known limits

- **Diagrams are read through their text labels.** The figures in the generated
  papers carry real text, so a mislabelled diagram is graded and annotated in
  the right place. A scanned hand-drawn diagram with no text layer is not read
  at all; the provider interface leaves room for a vision model to fill that
  gap.
- **No OCR.** A PDF with no text layer cannot be graded. Character-level scan
  damage in a text layer *is* handled — the matcher normalises the usual
  confusions (`rn`→`m`, `1`→`l`, `0`→`o`) and tolerates edit distance.
- **The offline grader is a lexical reader, not a marker.** It catches
  contradictions and missing vocabulary; it cannot judge the quality of an
  argument, and says so rather than pretending, which is why an essay question
  comes back with half marks and a review flag.
- **Annotation coordinates assume an unrotated page** with its origin at the
  bottom-left, which is what pdf.js reports for the papers here.
- **No authentication.** Out of scope for this exercise.

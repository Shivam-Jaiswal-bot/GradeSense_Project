# Architecture

## The shape of the problem

An LLM can mark an answer. What it cannot be trusted to do is arithmetic, honest
citation, or restraint: it will hand back 7 marks out of 5, quote a sentence the
student never wrote, and sound equally confident either way. So the model is
used for exactly one thing — judging whether an answer meets a rubric point —
and every other guarantee is enforced in code around it.

```
PDF ─► text + per-word boxes ─► rubric ─► segment ─► [ model ] ─► validate ─► grade
                                                          │                     │
                                                     retry/fallback         annotate
                                                                                │
                                                                        SQLite ─┴─► edit ─► export
```

## Stages

**1. Extraction** (`services/pdfText.ts`) — pdf.js gives every text item its
position. Items are grouped into visual lines by baseline, and each span records
the offset of its text inside the page's plain text. That offset map is what
later turns a quote into a rectangle on the page.

**2. Rubric parsing** (`services/rubric.ts`) — the marking scheme is read out of
the model answer *structurally*, not by an LLM. A hallucinated rubric would
corrupt every mark downstream and never look wrong. The parser handles the
wrapped table cells the source PDF produces, and reports what it could not read
instead of inventing it. On the supplied paper it produces 15 marks across 3
questions and 15 criteria with no warnings.

**3. Segmentation** (`services/segment.ts`) — the student's paper is split by
answer headings. When it cannot split reliably it says so, grades the whole text
against each question, and the run is flagged for review.

**4. Grading** (`services/llm/*`) — one request per question, carrying only that
question's rubric, model answer and answer text. The system prompt requires
verbatim evidence or an empty quote, and JSON only. Failures are retried with
backoff, and only errors worth retrying are retried — a bad API key is not a
transient fault.

**5. Validation** (`services/validate.ts`) — the trust boundary, and where the
assignment's hard rules are actually enforced:

- marks are clamped to the criterion maximum, rounded to half marks, never
  negative;
- question and paper totals are **recomputed** from the criteria, never taken
  from the model;
- every quote is located in the paper; an unlocatable quote is dropped;
- a mark awarded with no verifiable quote has its confidence capped;
- a status that contradicts the marks is reconciled;
- criteria the model omitted are recorded as zero and flagged, not skipped.

Every repair is recorded as an adjustment and surfaced in the UI and the
exported report. Nothing is silently fixed.

**6. Anchoring** (`services/anchor.ts`) — a quote is matched whitespace- and
OCR-insensitively, then converted to per-line rectangles through the span offset
map. If the match is not good enough it returns nothing: a mark drawn over the
wrong words is worse than a mark in the margin.

**7. Annotation** (`services/annotations.ts`) — each issue becomes one
annotation with a style, a severity and a rectangle. Unanchored issues are
stacked in the margin and marked `anchored: false` so the examiner knows the
placement is a fallback. Annotations are generated once and then stored on their
own; nothing reads them back into grading.

**8. Persistence** (`db/index.ts`) — SQLite. The original PDF bytes are stored
and never written to, so the annotated copy is always produced from an untouched
original. Runs are stored as JSON documents; annotations live in their own
table, which is what makes editing them independent of the marks.

**9. Export** (`services/exportPdf.ts`) — pdf-lib loads the original, draws
numbered marks on a copy, and appends an examiner's report with the breakdown,
the evidence and every comment. The original file is not modified.

## The offline grader

`services/llm/mock.ts` implements the same provider interface as Anthropic and
exists so the app and its tests run with no key and no network. It grades on two
rubric-agnostic signals:

1. **Lexical coverage** — how much of a rubric point's vocabulary (widened with
   the model answer's own wording for that point) the student uses, matched
   through misspelling and scan damage.
2. **Contradiction** — the student taking the opposite side of a polar pair
   (`series`/`parallel`, `shortage`/`surplus`, `higher`/`lower`) from the
   marking scheme about the same subject, or combining two such pairs the wrong
   way round ("above … shortage" where the scheme says "above … surplus").

The second signal is what catches confidently wrong answers, which score *well*
on similarity. Getting it to fire only on real errors needed some care, and the
rules are worth naming because they are where the false positives were:

- a polar word describes what comes **before** it in its clause, so "connected
  in parallel across the bulb" is about the voltmeter, not the bulb;
- clause boundaries are respected, so "the resistance is increased, the current
  decreases" is two claims, not one;
- verbs and adverbs cannot be subjects, so feedback names the voltmeter rather
  than "connect";
- "from left to right" uses both sides of a pair and therefore claims no
  direction at all;
- the reference is the *merged* top-scoring model sentences, so where the
  marking scheme itself says both "below … shortage" and "above … surplus", the
  disagreement cancels instead of flagging a correct answer;
- one mistake is charged to one rubric point, chosen by which criterion actually
  names the subject.

It reports its own limits: a rubric point about the quality of an argument gets
a provisional half mark at 0.2 confidence and an explicit "needs a human
examiner", which propagates to the review flag.

## Confidence and the review flag

Criterion confidence is mark-weighted into a question confidence and then into
the paper. The paper is flagged for review when it is blank, when a question is
unanswered, when segmentation was unreliable, when the fallback grader was used,
when overall confidence is below 55%, when marks were **awarded** on weak
evidence, or when marks were **withheld** on weak evidence — a mark denied
without support costs the student, and deserves the same scrutiny as one given.

## Client

React + TypeScript. pdf.js renders the pages; annotations are absolutely
positioned over them, converting PDF coordinates (origin bottom-left) to CSS.
Dragging updates local state for smoothness and PATCHes the annotation on
release. No client action re-grades anything — there is no endpoint that would.

## Choices worth defending

- **Rubric parsed, not prompted.** A wrong rubric is invisible in the output.
- **Totals recomputed, never trusted.** The model's arithmetic is not evidence.
- **Evidence verified against the paper.** Unverifiable feedback is dropped, not
  softened.
- **Anchoring refuses to guess.** Wrong placement is worse than the margin.
- **Annotations stored apart from grading.** The editability requirement is a
  data-model decision, not a UI one.
- **A real fallback grader, not a stub.** The failure path is exercised by the
  demo and the tests, not just described.

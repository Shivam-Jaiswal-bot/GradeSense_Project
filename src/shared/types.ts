/**
 * Types shared by the server and the browser client.
 * This file is the contract: the grading pipeline, the persistence layer, the
 * REST API and the annotation editor all speak these shapes.
 */

/* ------------------------------------------------------------------ */
/* Documents                                                           */
/* ------------------------------------------------------------------ */

export type DocumentKind = 'question_paper' | 'model_answer' | 'student_answer';

export interface DocumentSummary {
  id: string;
  kind: DocumentKind;
  filename: string;
  pageCount: number;
  charCount: number;
  createdAt: string;
}

/** A word/line of extracted text with its position on the page. */
export interface TextSpan {
  page: number; // 1-based
  text: string;
  /** PDF user-space coordinates, origin bottom-left, as reported by pdf.js. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Offset of this span's text inside the page's normalised plain text. */
  offset: number;
}

export interface PageGeometry {
  page: number;
  width: number;
  height: number;
}

export interface ExtractedDocument {
  text: string;
  pages: PageGeometry[];
  spans: TextSpan[];
}

/* ------------------------------------------------------------------ */
/* Rubric                                                              */
/* ------------------------------------------------------------------ */

export interface RubricCriterion {
  id: string; // e.g. "q1.c2"
  description: string;
  maxMarks: number;
}

export interface RubricQuestion {
  id: string; // e.g. "q1"
  number: number;
  subject: string;
  prompt: string;
  maxMarks: number;
  modelAnswer: string;
  criteria: RubricCriterion[];
  /** Free-text grader guidance, e.g. "do not penalise a differing conclusion". */
  guidance?: string;
}

export interface Rubric {
  title: string;
  maxMarks: number;
  questions: RubricQuestion[];
}

/* ------------------------------------------------------------------ */
/* Grading                                                             */
/* ------------------------------------------------------------------ */

export type CriterionStatus = 'correct' | 'partial' | 'missing' | 'incorrect';

/** A verbatim quote from the student's answer, with where it sits on the page. */
export interface Evidence {
  quote: string;
  /** Character offset into the student answer's normalised text; -1 if unlocated. */
  offset: number;
  page?: number;
  rects?: Rect[];
}

export interface Rect {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CriterionResult {
  criterionId: string;
  description: string;
  maxMarks: number;
  awardedMarks: number;
  status: CriterionStatus;
  /** Quotes from the student answer that justify the award. */
  evidence: Evidence[];
  /** What the student got right, in the grader's words. */
  feedback: string;
  /** What the answer should have said instead. Empty when fully correct. */
  correction: string;
  confidence: number; // 0..1
  /** Set when validation had to alter what the model returned. */
  adjustments: string[];
}

export type IssueType =
  | 'missing_point'
  | 'wrong_reasoning'
  | 'factual_error'
  | 'spelling'
  | 'grammar'
  | 'layout';

/** One mistake to be drawn on the paper. */
export interface GradingIssue {
  id: string;
  questionId: string;
  criterionId: string | null;
  type: IssueType;
  /** The student's text that is wrong. Empty for a missing point. */
  quote: string;
  correction: string;
  comment: string;
  marksLost: number;
  confidence: number;
}

export interface QuestionResult {
  questionId: string;
  number: number;
  subject: string;
  maxMarks: number;
  awardedMarks: number;
  criteria: CriterionResult[];
  issues: GradingIssue[];
  summary: string;
  confidence: number;
  /** Character range of this question's answer inside the student text. */
  answerRange?: { start: number; end: number };
}

export type ProviderMode = 'anthropic' | 'mock' | 'anthropic->mock';

export interface GradingRun {
  id: string;
  createdAt: string;
  studentDocumentId: string;
  studentName: string | null;
  questionPaperId: string | null;
  modelAnswerId: string | null;
  maxMarks: number;
  awardedMarks: number;
  questions: QuestionResult[];
  confidence: number;
  needsHumanReview: boolean;
  reviewReasons: string[];
  provider: ProviderMode;
  model: string;
  /** Everything the validation layer had to fix in the raw model output. */
  adjustments: string[];
  degraded: boolean;
  durationMs: number;
}

/* ------------------------------------------------------------------ */
/* Annotations                                                         */
/* ------------------------------------------------------------------ */

export type AnnotationStyle = 'box' | 'underline' | 'strikethrough' | 'note';

/**
 * An annotation is created from a grading issue but then lives independently:
 * moving, editing or deleting one never re-runs grading.
 */
export interface Annotation {
  id: string;
  runId: string;
  issueId: string | null;
  questionId: string;
  style: AnnotationStyle;
  severity: 'error' | 'warning' | 'info';
  page: number;
  /** Position in PDF user space, origin bottom-left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Shown next to the mark on the exported PDF. */
  text: string;
  marksLost: number;
  /** True once a human has moved/edited it. */
  edited: boolean;
  /** False when the anchor could not be located and it was placed by fallback. */
  anchored: boolean;
  createdAt: string;
  updatedAt: string;
}

export type AnnotationDraft = Omit<Annotation, 'id' | 'createdAt' | 'updatedAt' | 'edited'> &
  Partial<Pick<Annotation, 'id' | 'edited'>>;

/* ------------------------------------------------------------------ */
/* API                                                                 */
/* ------------------------------------------------------------------ */

export interface ApiError {
  error: string;
  code: string;
  detail?: string;
}

export interface GradeRequest {
  studentDocumentId: string;
  questionPaperId?: string;
  modelAnswerId?: string;
  studentName?: string;
}

export interface RunDetail {
  run: GradingRun;
  annotations: Annotation[];
  document: DocumentSummary;
  pages: PageGeometry[];
}

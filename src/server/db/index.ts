/**
 * Persistence. A single SQLite file holds the uploaded papers, every grading
 * run and every annotation.
 *
 * Two rules shape the schema:
 *   - the original PDF bytes are stored and never written to, so an annotated
 *     copy can always be produced from an untouched original;
 *   - annotations live in their own table, not inside the run's JSON, because
 *     editing one must never require re-grading.
 */

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type {
  Annotation,
  AnnotationDraft,
  DocumentKind,
  DocumentSummary,
  ExtractedDocument,
  GradingRun,
  PageGeometry,
  TextSpan,
} from '../../shared/types.js';

export interface StoredDocument extends DocumentSummary {
  text: string;
  spans: TextSpan[];
  pages: PageGeometry[];
}

export interface RunSummary {
  id: string;
  createdAt: string;
  studentName: string | null;
  filename: string;
  awardedMarks: number;
  maxMarks: number;
  confidence: number;
  needsHumanReview: boolean;
  provider: string;
  annotationCount: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  kind        TEXT NOT NULL,
  filename    TEXT NOT NULL,
  bytes       BLOB NOT NULL,
  text        TEXT NOT NULL,
  spans       TEXT NOT NULL,
  pages       TEXT NOT NULL,
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id                  TEXT PRIMARY KEY,
  created_at          TEXT NOT NULL,
  student_document_id TEXT NOT NULL REFERENCES documents(id),
  payload             TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS annotations (
  id         TEXT PRIMARY KEY,
  run_id     TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  ordinal    INTEGER NOT NULL,
  payload    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_annotations_run ON annotations(run_id, ordinal);
CREATE INDEX IF NOT EXISTS idx_runs_created ON runs(created_at DESC);
`;

export class Store {
  private readonly db: Database.Database;

  constructor(file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  /* ----------------------------- documents ---------------------------- */

  saveDocument(
    kind: DocumentKind,
    filename: string,
    bytes: Buffer,
    extracted: ExtractedDocument,
  ): StoredDocument {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO documents (id, kind, filename, bytes, text, spans, pages, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        kind,
        filename,
        bytes,
        extracted.text,
        JSON.stringify(extracted.spans),
        JSON.stringify(extracted.pages),
        createdAt,
      );
    return {
      id,
      kind,
      filename,
      createdAt,
      pageCount: extracted.pages.length,
      charCount: extracted.text.length,
      text: extracted.text,
      spans: extracted.spans,
      pages: extracted.pages,
    };
  }

  getDocument(id: string): StoredDocument | null {
    const row = this.db
      .prepare(
        `SELECT id, kind, filename, text, spans, pages, created_at FROM documents WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          kind: DocumentKind;
          filename: string;
          text: string;
          spans: string;
          pages: string;
          created_at: string;
        }
      | undefined;
    if (!row) return null;
    const pages = JSON.parse(row.pages) as PageGeometry[];
    return {
      id: row.id,
      kind: row.kind,
      filename: row.filename,
      createdAt: row.created_at,
      pageCount: pages.length,
      charCount: row.text.length,
      text: row.text,
      spans: JSON.parse(row.spans) as TextSpan[],
      pages,
    };
  }

  /** The untouched upload, for producing an annotated copy. */
  getDocumentBytes(id: string): Buffer | null {
    const row = this.db.prepare(`SELECT bytes FROM documents WHERE id = ?`).get(id) as
      | { bytes: Buffer }
      | undefined;
    return row?.bytes ?? null;
  }

  /* -------------------------------- runs ------------------------------ */

  saveRun(run: GradingRun, annotations: AnnotationDraft[]): Annotation[] {
    const stored: Annotation[] = [];
    const insertRun = this.db.prepare(
      `INSERT INTO runs (id, created_at, student_document_id, payload) VALUES (?, ?, ?, ?)`,
    );
    const insertAnnotation = this.db.prepare(
      `INSERT INTO annotations (id, run_id, ordinal, payload) VALUES (?, ?, ?, ?)`,
    );

    this.db.transaction(() => {
      insertRun.run(run.id, run.createdAt, run.studentDocumentId, JSON.stringify(run));
      annotations.forEach((draft, ordinal) => {
        const annotation = materialise(draft, run.id);
        insertAnnotation.run(annotation.id, run.id, ordinal, JSON.stringify(annotation));
        stored.push(annotation);
      });
    })();

    return stored;
  }

  getRun(id: string): GradingRun | null {
    const row = this.db.prepare(`SELECT payload FROM runs WHERE id = ?`).get(id) as
      | { payload: string }
      | undefined;
    return row ? (JSON.parse(row.payload) as GradingRun) : null;
  }

  listRuns(limit = 50): RunSummary[] {
    const rows = this.db
      .prepare(
        `SELECT r.payload, d.filename,
                (SELECT COUNT(*) FROM annotations a WHERE a.run_id = r.id) AS annotation_count
           FROM runs r
           JOIN documents d ON d.id = r.student_document_id
          ORDER BY r.created_at DESC
          LIMIT ?`,
      )
      .all(limit) as { payload: string; filename: string; annotation_count: number }[];

    return rows.map((row) => {
      const run = JSON.parse(row.payload) as GradingRun;
      return {
        id: run.id,
        createdAt: run.createdAt,
        studentName: run.studentName,
        filename: row.filename,
        awardedMarks: run.awardedMarks,
        maxMarks: run.maxMarks,
        confidence: run.confidence,
        needsHumanReview: run.needsHumanReview,
        provider: run.provider,
        annotationCount: row.annotation_count,
      };
    });
  }

  /* ---------------------------- annotations --------------------------- */

  listAnnotations(runId: string): Annotation[] {
    const rows = this.db
      .prepare(`SELECT payload FROM annotations WHERE run_id = ? ORDER BY ordinal`)
      .all(runId) as { payload: string }[];
    return rows.map((row) => JSON.parse(row.payload) as Annotation);
  }

  getAnnotation(runId: string, id: string): Annotation | null {
    const row = this.db
      .prepare(`SELECT payload FROM annotations WHERE run_id = ? AND id = ?`)
      .get(runId, id) as { payload: string } | undefined;
    return row ? (JSON.parse(row.payload) as Annotation) : null;
  }

  addAnnotation(runId: string, draft: AnnotationDraft): Annotation {
    const next = this.db
      .prepare(`SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM annotations WHERE run_id = ?`)
      .get(runId) as { ordinal: number };
    const annotation = materialise(draft, runId);
    this.db
      .prepare(`INSERT INTO annotations (id, run_id, ordinal, payload) VALUES (?, ?, ?, ?)`)
      .run(annotation.id, runId, next.ordinal, JSON.stringify(annotation));
    return annotation;
  }

  /** Applies a partial update. Grading is never re-run; only the mark moves. */
  updateAnnotation(
    runId: string,
    id: string,
    patch: Partial<Omit<Annotation, 'id' | 'runId' | 'createdAt'>>,
  ): Annotation | null {
    const current = this.getAnnotation(runId, id);
    if (!current) return null;
    const updated: Annotation = {
      ...current,
      ...patch,
      id: current.id,
      runId: current.runId,
      createdAt: current.createdAt,
      edited: true,
      updatedAt: new Date().toISOString(),
    };
    this.db
      .prepare(`UPDATE annotations SET payload = ? WHERE run_id = ? AND id = ?`)
      .run(JSON.stringify(updated), runId, id);
    return updated;
  }

  deleteAnnotation(runId: string, id: string): boolean {
    const result = this.db
      .prepare(`DELETE FROM annotations WHERE run_id = ? AND id = ?`)
      .run(runId, id);
    return result.changes > 0;
  }
}

function materialise(draft: AnnotationDraft, runId: string): Annotation {
  const now = new Date().toISOString();
  return {
    ...draft,
    id: draft.id ?? randomUUID(),
    runId,
    edited: draft.edited ?? false,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * The HTTP layer.
 *
 * Grading happens once, on upload. Everything after that - listing, viewing,
 * moving an annotation, exporting the annotated copy - reads what was stored.
 * No route re-grades a paper, which is what makes the annotations editable
 * without the marks shifting under the examiner.
 */

import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { AnnotationDraft, ApiError } from '../shared/types.js';
import { Store } from './db/index.js';
import { buildAnnotations } from './services/annotations.js';
import { buildAnnotatedPdf } from './services/exportPdf.js';
import { gradePaper } from './services/grader.js';
import type { ProviderSet } from './services/llm/index.js';
import { extractPdf } from './services/pdfText.js';
import { parseRubric } from './services/rubric.js';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export interface AppOptions {
  store: Store;
  providers: ProviderSet;
  /** Built client to serve from the same origin. Absent in development. */
  clientDir?: string | null;
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 3 },
});

const uploadFields = upload.fields([
  { name: 'questionPaper', maxCount: 1 },
  { name: 'modelAnswer', maxCount: 1 },
  { name: 'studentAnswer', maxCount: 1 },
]);

/** Every write to an annotation goes through this; nothing else is accepted. */
const annotationPatchSchema = z
  .object({
    style: z.enum(['box', 'underline', 'strikethrough', 'note']),
    severity: z.enum(['error', 'warning', 'info']),
    page: z.number().int().min(1),
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().min(1),
    height: z.number().finite().min(1),
    text: z.string().max(2000),
    marksLost: z.number().min(0),
    anchored: z.boolean(),
  })
  .partial()
  .refine((patch) => Object.keys(patch).length > 0, { message: 'empty patch' });

const annotationCreateSchema = z.object({
  questionId: z.string().min(1).max(64),
  style: z.enum(['box', 'underline', 'strikethrough', 'note']).default('box'),
  severity: z.enum(['error', 'warning', 'info']).default('info'),
  page: z.number().int().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite().min(1),
  height: z.number().finite().min(1),
  text: z.string().max(2000).default(''),
  marksLost: z.number().min(0).default(0),
});

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

/** Async handlers must not drop rejections; Express 4 will not catch them. */
function route(handler: (req: Request, res: Response) => Promise<void> | void) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res)).catch(next);
  };
}

function requirePdf(file: Express.Multer.File | undefined, field: string): Express.Multer.File {
  if (!file) throw new HttpError(400, 'missing_file', `${field} is required.`);
  const looksPdf =
    file.mimetype === 'application/pdf' ||
    file.originalname.toLowerCase().endsWith('.pdf') ||
    file.buffer.subarray(0, 5).toString('latin1') === '%PDF-';
  if (!looksPdf) throw new HttpError(415, 'unsupported_type', `${field} must be a PDF.`);
  if (file.size === 0) throw new HttpError(400, 'empty_file', `${field} is empty.`);
  return file;
}

/** Route parameters are untrusted input like any other. */
function param(req: Request, name: string): string {
  const value = (req.params as Record<string, unknown>)[name];
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) {
    throw new HttpError(400, 'invalid_id', `${name} is missing or malformed.`);
  }
  return value;
}

function filesOf(req: Request): Record<string, Express.Multer.File[]> {
  return (req.files ?? {}) as Record<string, Express.Multer.File[]>;
}

export function createApp({ store, providers, clientDir }: AppOptions) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', provider: providers.primary.name, model: providers.primary.model });
  });

  /* --------------------------- upload + grade -------------------------- */

  app.post(
    '/api/runs',
    uploadFields,
    route(async (req, res) => {
      const files = filesOf(req);
      const studentFile = requirePdf(files.studentAnswer?.[0], 'studentAnswer');
      const modelFile = requirePdf(files.modelAnswer?.[0], 'modelAnswer');
      const questionFile = files.questionPaper?.[0]
        ? requirePdf(files.questionPaper[0], 'questionPaper')
        : null;

      const [student, model, question] = await Promise.all([
        extractPdf(new Uint8Array(studentFile.buffer)),
        extractPdf(new Uint8Array(modelFile.buffer)),
        questionFile ? extractPdf(new Uint8Array(questionFile.buffer)) : Promise.resolve(null),
      ]).catch((error: unknown) => {
        throw new HttpError(
          422,
          'unreadable_pdf',
          'A PDF could not be read.',
          error instanceof Error ? error.message : String(error),
        );
      });

      const { rubric, warnings } = parseRubric(model.text, question?.text);
      if (rubric.questions.length === 0) {
        throw new HttpError(
          422,
          'unreadable_rubric',
          'No rubric could be read from the model answer.',
          warnings.join(' '),
        );
      }

      const studentDoc = store.saveDocument(
        'student_answer',
        studentFile.originalname,
        studentFile.buffer,
        student,
      );
      const modelDoc = store.saveDocument(
        'model_answer',
        modelFile.originalname,
        modelFile.buffer,
        model,
      );
      const questionDoc =
        questionFile && question
          ? store.saveDocument(
              'question_paper',
              questionFile.originalname,
              questionFile.buffer,
              question,
            )
          : null;

      const run = await gradePaper({
        rubric,
        studentText: student.text,
        spans: student.spans,
        pages: student.pages,
        studentDocumentId: studentDoc.id,
        modelAnswerId: modelDoc.id,
        questionPaperId: questionDoc?.id ?? null,
        studentName: typeof req.body?.studentName === 'string' ? req.body.studentName : null,
        providers,
      });
      run.adjustments.push(...warnings);

      const annotations = buildAnnotations({
        run,
        documentText: student.text,
        spans: student.spans,
        pages: student.pages,
      });
      const stored = store.saveRun(run, annotations as AnnotationDraft[]);

      res.status(201).json({
        run,
        annotations: stored,
        document: {
          id: studentDoc.id,
          kind: studentDoc.kind,
          filename: studentDoc.filename,
          pageCount: studentDoc.pageCount,
          charCount: studentDoc.charCount,
          createdAt: studentDoc.createdAt,
        },
        pages: studentDoc.pages,
      });
    }),
  );

  /* ------------------------------- history ----------------------------- */

  app.get('/api/runs', (_req, res) => {
    res.json({ runs: store.listRuns() });
  });

  app.get('/api/runs/:id', (req, res) => {
    const run = store.getRun(param(req, 'id'));
    if (!run) throw new HttpError(404, 'not_found', 'No such grading run.');
    const document = store.getDocument(run.studentDocumentId);
    if (!document) throw new HttpError(410, 'document_missing', 'The answer paper is gone.');
    res.json({
      run,
      annotations: store.listAnnotations(run.id),
      document: {
        id: document.id,
        kind: document.kind,
        filename: document.filename,
        pageCount: document.pageCount,
        charCount: document.charCount,
        createdAt: document.createdAt,
      },
      pages: document.pages,
    });
  });

  /** The original upload, byte for byte, for rendering in the browser. */
  app.get('/api/runs/:id/document', (req, res) => {
    const run = store.getRun(param(req, 'id'));
    if (!run) throw new HttpError(404, 'not_found', 'No such grading run.');
    const bytes = store.getDocumentBytes(run.studentDocumentId);
    if (!bytes) throw new HttpError(410, 'document_missing', 'The answer paper is gone.');
    res.type('application/pdf').send(bytes);
  });

  /* ----------------------------- annotations --------------------------- */

  app.post(
    '/api/runs/:id/annotations',
    route((req, res) => {
      const run = store.getRun(param(req, 'id'));
      if (!run) throw new HttpError(404, 'not_found', 'No such grading run.');
      const parsed = annotationCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, 'invalid_annotation', 'Annotation is invalid.', issues(parsed));
      }
      const annotation = store.addAnnotation(run.id, {
        ...parsed.data,
        runId: run.id,
        issueId: null,
        anchored: true,
        edited: true,
      });
      res.status(201).json(annotation);
    }),
  );

  app.patch(
    '/api/runs/:id/annotations/:annotationId',
    route((req, res) => {
      const parsed = annotationPatchSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new HttpError(400, 'invalid_patch', 'Annotation patch is invalid.', issues(parsed));
      }
      const updated = store.updateAnnotation(param(req, 'id'), param(req, 'annotationId'), parsed.data);
      if (!updated) throw new HttpError(404, 'not_found', 'No such annotation.');
      res.json(updated);
    }),
  );

  app.delete('/api/runs/:id/annotations/:annotationId', (req, res) => {
    if (!store.deleteAnnotation(param(req, 'id'), param(req, 'annotationId'))) {
      throw new HttpError(404, 'not_found', 'No such annotation.');
    }
    res.status(204).end();
  });

  /* ------------------------------- export ------------------------------ */

  app.get(
    '/api/runs/:id/export',
    route(async (req, res) => {
      const run = store.getRun(param(req, 'id'));
      if (!run) throw new HttpError(404, 'not_found', 'No such grading run.');
      const original = store.getDocumentBytes(run.studentDocumentId);
      const document = store.getDocument(run.studentDocumentId);
      if (!original || !document) {
        throw new HttpError(410, 'document_missing', 'The answer paper is gone.');
      }
      const pdf = await buildAnnotatedPdf({
        originalPdf: original,
        run,
        annotations: store.listAnnotations(run.id),
        studentName: run.studentName,
      });
      const name = document.filename.replace(/\.pdf$/i, '');
      res
        .type('application/pdf')
        .setHeader('Content-Disposition', `attachment; filename="${name}-annotated.pdf"`);
      res.send(Buffer.from(pdf));
    }),
  );

  // Must come before the catch-all 404, and never shadow the API.
  if (clientDir) {
    app.use(express.static(clientDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(resolve(clientDir, 'index.html')));
  }

  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      const body: ApiError = { error: 'Not found.', code: 'not_found' };
      res.status(404).json(body);
      return;
    }
    res.status(404).send('Not found');
  });

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof HttpError) {
      const body: ApiError = { error: error.message, code: error.code, detail: error.detail };
      res.status(error.status).json(body);
      return;
    }
    if (error instanceof multer.MulterError) {
      const body: ApiError = { error: error.message, code: `upload_${error.code.toLowerCase()}` };
      res.status(413).json(body);
      return;
    }
    const body: ApiError = {
      error: 'The server could not complete the request.',
      code: 'internal_error',
      detail: error instanceof Error ? error.message : String(error),
    };
    res.status(500).json(body);
  });

  return app;
}

function issues(parsed: { error: z.ZodError }): string {
  return parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

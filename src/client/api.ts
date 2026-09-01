/** Thin typed wrapper over the REST API. */

import type { Annotation, ApiError, RunDetail } from '../shared/types.js';

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

async function unwrap<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  let detail = response.statusText;
  try {
    const body = (await response.json()) as ApiError;
    detail = body.detail ? `${body.error} ${body.detail}` : body.error;
  } catch {
    /* the body was not JSON; the status text is all we have */
  }
  throw new Error(detail);
}

export async function gradePapers(files: {
  studentAnswer: File;
  modelAnswer: File;
  questionPaper?: File | null;
  studentName?: string;
}): Promise<RunDetail> {
  const form = new FormData();
  form.append('studentAnswer', files.studentAnswer);
  form.append('modelAnswer', files.modelAnswer);
  if (files.questionPaper) form.append('questionPaper', files.questionPaper);
  if (files.studentName) form.append('studentName', files.studentName);
  return unwrap<RunDetail>(await fetch('/api/runs', { method: 'POST', body: form }));
}

export async function listRuns(): Promise<RunSummary[]> {
  const body = await unwrap<{ runs: RunSummary[] }>(await fetch('/api/runs'));
  return body.runs;
}

export async function getRun(id: string): Promise<RunDetail> {
  return unwrap<RunDetail>(await fetch(`/api/runs/${id}`));
}

export async function patchAnnotation(
  runId: string,
  id: string,
  patch: Partial<Annotation>,
): Promise<Annotation> {
  return unwrap<Annotation>(
    await fetch(`/api/runs/${runId}/annotations/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    }),
  );
}

export async function createAnnotation(
  runId: string,
  draft: Partial<Annotation> & { page: number; x: number; y: number; width: number; height: number },
): Promise<Annotation> {
  return unwrap<Annotation>(
    await fetch(`/api/runs/${runId}/annotations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(draft),
    }),
  );
}

export async function deleteAnnotation(runId: string, id: string): Promise<void> {
  const response = await fetch(`/api/runs/${runId}/annotations/${id}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 404) throw new Error('Could not delete the annotation.');
}

export function documentUrl(runId: string): string {
  return `/api/runs/${runId}/document`;
}

export function exportUrl(runId: string): string {
  return `/api/runs/${runId}/export`;
}

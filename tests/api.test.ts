/**
 * End to end over HTTP: upload three PDFs, get a graded run back, edit the
 * annotations, export the annotated copy, and re-read the run from history.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { createApp } from '../src/server/app.js';
import { Store } from '../src/server/db/index.js';
import { MockProvider } from '../src/server/services/llm/mock.js';
import type { Annotation, RunDetail } from '../src/shared/types.js';
import { answerPath, bytesOf, PAPERS } from './helpers.js';

let store: Store;
let app: Express;

beforeAll(() => {
  store = new Store(':memory:');
  app = createApp({ store, providers: { primary: new MockProvider(), fallback: null } });
});

afterAll(() => store.close());

function uploadPlanted() {
  return request(app)
    .post('/api/runs')
    .attach('questionPaper', PAPERS.questionPaper)
    .attach('modelAnswer', PAPERS.modelAnswer)
    .attach('studentAnswer', answerPath('planted'))
    .field('studentName', 'Ananya Sharma');
}

describe('the API', () => {
  it('reports which grading provider is in use', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body).toMatchObject({ status: 'ok', provider: 'mock' });
  });

  it('rejects an upload that is not a PDF', async () => {
    const response = await request(app)
      .post('/api/runs')
      .attach('modelAnswer', Buffer.from('not a pdf at all'), 'notes.txt')
      .attach('studentAnswer', answerPath('planted'))
      .expect(415);
    expect(response.body.code).toBe('unsupported_type');
  });

  it('rejects an upload with no student answer', async () => {
    const response = await request(app)
      .post('/api/runs')
      .attach('modelAnswer', PAPERS.modelAnswer)
      .expect(400);
    expect(response.body.code).toBe('missing_file');
  });

  it('grades an upload, stores it, and lets the annotations be edited afterwards', async () => {
    const created = await uploadPlanted().expect(201);
    const detail = created.body as RunDetail;

    expect(detail.run.maxMarks).toBe(15);
    expect(detail.run.awardedMarks).toBeLessThanOrEqual(15);
    expect(detail.run.studentName).toBe('Ananya Sharma');
    expect(detail.annotations.length).toBeGreaterThan(0);
    expect(detail.pages.length).toBeGreaterThan(0);

    const runId = detail.run.id;
    const target = detail.annotations[0]!;

    /* --- moving an annotation must not disturb the marks --- */
    const moved = await request(app)
      .patch(`/api/runs/${runId}/annotations/${target.id}`)
      .send({ x: target.x + 25, y: target.y - 12, text: 'Moved by the examiner' })
      .expect(200);
    const movedAnnotation = moved.body as Annotation;
    expect(movedAnnotation.x).toBeCloseTo(target.x + 25, 5);
    expect(movedAnnotation.edited).toBe(true);

    const afterEdit = await request(app).get(`/api/runs/${runId}`).expect(200);
    expect((afterEdit.body as RunDetail).run.awardedMarks).toBe(detail.run.awardedMarks);
    expect((afterEdit.body as RunDetail).run.questions).toEqual(detail.run.questions);

    /* --- adding and deleting --- */
    const added = await request(app)
      .post(`/api/runs/${runId}/annotations`)
      .send({
        questionId: 'q1',
        page: 1,
        x: 60,
        y: 400,
        width: 120,
        height: 30,
        text: 'Examiner note',
        style: 'note',
      })
      .expect(201);
    const addedId = (added.body as Annotation).id;

    const listed = await request(app).get(`/api/runs/${runId}`).expect(200);
    expect((listed.body as RunDetail).annotations).toHaveLength(detail.annotations.length + 1);

    await request(app).delete(`/api/runs/${runId}/annotations/${addedId}`).expect(204);
    await request(app).delete(`/api/runs/${runId}/annotations/${addedId}`).expect(404);

    const afterDelete = await request(app).get(`/api/runs/${runId}`).expect(200);
    expect((afterDelete.body as RunDetail).annotations).toHaveLength(detail.annotations.length);

    /* --- a nonsense patch is refused --- */
    await request(app)
      .patch(`/api/runs/${runId}/annotations/${target.id}`)
      .send({ width: -50 })
      .expect(400);

    /* --- history --- */
    const history = await request(app).get('/api/runs').expect(200);
    expect(history.body.runs[0]).toMatchObject({ id: runId, studentName: 'Ananya Sharma' });

    /* --- export: a new PDF, with the original left untouched --- */
    const exported = await request(app)
      .get(`/api/runs/${runId}/export`)
      .expect(200)
      .expect('Content-Type', /pdf/);
    expect(exported.body.subarray(0, 5).toString('latin1')).toBe('%PDF-');

    const original = await request(app).get(`/api/runs/${runId}/document`).expect(200);
    const uploaded = await bytesOf(answerPath('planted'));
    expect(Buffer.compare(original.body, uploaded)).toBe(0);
    expect(exported.body.length).toBeGreaterThan(uploaded.length);
  });

  it('404s for a run that does not exist', async () => {
    await request(app).get('/api/runs/does-not-exist').expect(404);
    await request(app).get('/api/runs/does-not-exist/export').expect(404);
  });
});

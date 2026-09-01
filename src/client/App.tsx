/**
 * Application shell: upload, then the graded paper beside its marks.
 *
 * Annotation edits are optimistic and go straight to the annotation API. The
 * grading run in state is never recomputed by them - that separation is the
 * point of the tool.
 */

import { useCallback, useEffect, useState } from 'react';
import * as api from './api.js';
import type { RunSummary } from './api.js';
import { AnnotationInspector } from './components/AnnotationInspector.js';
import { EmptyState, GradingProgress } from './components/EmptyState.js';
import { PaperView } from './components/PaperView.js';
import { ScorePanel, percentOf } from './components/ScorePanel.js';
import { UploadPanel } from './components/UploadPanel.js';
import { Alert, Chevron, Clock, Close, Download, LogoGlyph, Plus } from './components/icons.js';
import type { Annotation, RunDetail } from '../shared/types.js';

/** Matches the breakpoint at which the sidebar stops being a fixed column. */
const NARROW = '(max-width: 960px)';

export function App() {
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const refreshHistory = useCallback(() => {
    api.listRuns().then(setHistory).catch(() => setHistory([]));
  }, []);

  useEffect(refreshHistory, [refreshHistory]);

  /** On a phone the sidebar is the whole screen, so step out of the way. */
  const collapseOnNarrow = () => {
    if (window.matchMedia(NARROW).matches) setPanelOpen(false);
  };

  const grade = async (files: Parameters<typeof api.gradePapers>[0]) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.gradePapers(files);
      setDetail(result);
      setSelectedId(null);
      refreshHistory();
      collapseOnNarrow();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const open = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      setDetail(await api.getRun(id));
      setSelectedId(null);
      collapseOnNarrow();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  /** Applies the change locally first so dragging stays smooth. */
  const changeAnnotation = (id: string, patch: Partial<Annotation>) => {
    setDetail((current) =>
      current
        ? {
            ...current,
            annotations: current.annotations.map((annotation) =>
              annotation.id === id ? { ...annotation, ...patch, edited: true } : annotation,
            ),
          }
        : current,
    );
    const runId = detail?.run.id;
    if (!runId) return;
    api.patchAnnotation(runId, id, patch).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  const removeAnnotation = (id: string) => {
    const runId = detail?.run.id;
    if (!runId) return;
    setDetail((current) =>
      current
        ? { ...current, annotations: current.annotations.filter((a) => a.id !== id) }
        : current,
    );
    setSelectedId(null);
    api.deleteAnnotation(runId, id).catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  const addNote = async (page: number, x: number, y: number) => {
    const run = detail?.run;
    if (!run) return;
    try {
      const created = await api.createAnnotation(run.id, {
        questionId: run.questions[0]?.questionId ?? 'q1',
        style: 'note',
        severity: 'info',
        page,
        x: Math.max(4, x - 75),
        y: Math.max(4, y - 17),
        width: 150,
        height: 34,
        text: 'New note',
        marksLost: 0,
      });
      setDetail((current) =>
        current ? { ...current, annotations: [...current.annotations, created] } : current,
      );
      setSelectedId(created.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const selected = detail?.annotations.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <span className="brand-mark">
              <LogoGlyph />
            </span>
            <span className="brand-text">
              <span className="brand-name">GradeSense</span>
              <span className="brand-tag">
                Explainable grading and annotation for exam answer papers
              </span>
            </span>
          </div>

          <div className="topbar-actions">
            {detail && (
              <span className="pill tone-accent" title={`Graded by ${detail.run.model}`}>
                <span className="dot" />
                {detail.run.provider}
              </span>
            )}
            {detail && (
              <a className="btn btn-ghost" href={api.exportUrl(detail.run.id)} download>
                <Download size={15} />
                <span className="btn-label-wide">Download annotated PDF</span>
              </a>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="alert-wrap">
          <div className="alert" role="alert">
            <Alert size={16} />
            <span className="alert-text">{error}</span>
            <button
              type="button"
              className="icon-btn"
              aria-label="Dismiss this message"
              onClick={() => setError(null)}
            >
              <Close size={14} />
            </button>
          </div>
        </div>
      )}

      <div className={`shell${detail ? '' : ' is-empty'}`}>
        <button
          type="button"
          className="btn sidebar-toggle"
          aria-expanded={panelOpen}
          aria-controls="grading-sidebar"
          onClick={() => setPanelOpen((open) => !open)}
        >
          <Plus size={15} />
          {panelOpen ? 'Hide grading panel' : 'New grading session'}
        </button>

        <aside
          className={`sidebar${panelOpen ? '' : ' is-collapsed'}`}
          id="grading-sidebar"
          aria-label="Grading session"
        >
          <UploadPanel busy={busy} onSubmit={grade} />
          <History runs={history} activeId={detail?.run.id ?? null} onOpen={open} />
        </aside>

        <main className="workspace">
          {detail ? (
            <div className="result">
              <div className="card result-bar">
                <div className="result-id">
                  <h2>{detail.run.studentName ?? detail.document.filename}</h2>
                  <p className="result-meta">
                    <span>{detail.document.filename}</span>
                    <span className="sep">·</span>
                    <span>
                      {detail.pages.length} page{detail.pages.length === 1 ? '' : 's'}
                    </span>
                    <span className="sep">·</span>
                    <span>
                      {detail.annotations.length} annotation
                      {detail.annotations.length === 1 ? '' : 's'}
                    </span>
                  </p>
                </div>
                <div className="result-tally">
                  <span className="tally-marks">
                    {detail.run.awardedMarks}
                    <span>/ {detail.run.maxMarks}</span>
                  </span>
                  <span className="pill tone-accent">
                    {percentOf(detail.run.awardedMarks, detail.run.maxMarks)}%
                  </span>
                </div>
              </div>

              <div className="result-grid">
                <section className="card paper-shell" aria-label="Answer paper">
                  <PaperView
                    documentUrl={api.documentUrl(detail.run.id)}
                    pages={detail.pages}
                    annotations={detail.annotations}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onChange={changeAnnotation}
                    onAddNote={addNote}
                  />
                </section>
                <div className="rail">
                  <AnnotationInspector
                    annotation={selected}
                    onChange={changeAnnotation}
                    onDelete={removeAnnotation}
                  />
                  <ScorePanel run={detail.run} />
                </div>
              </div>
            </div>
          ) : busy ? (
            <GradingProgress />
          ) : (
            <EmptyState />
          )}
        </main>
      </div>
    </div>
  );
}

function History({
  runs,
  activeId,
  onOpen,
}: {
  runs: RunSummary[];
  activeId: string | null;
  onOpen: (id: string) => void;
}) {
  return (
    <section className="card sessions">
      <div className="card-head">
        <h2 className="card-title">Recent grading sessions</h2>
      </div>
      <div className="sessions-body">
        {runs.length === 0 ? (
          <div className="sessions-empty">
            <span className="se-icon">
              <Clock size={17} />
            </span>
            <strong>No sessions yet</strong>
            <p>
              Your graded papers appear here, with their scores, feedback and annotations ready to
              reopen.
            </p>
          </div>
        ) : (
          <ul className="session-list">
            {runs.map((run) => (
              <li key={run.id}>
                <button
                  type="button"
                  className={`session${run.id === activeId ? ' is-active' : ''}`}
                  aria-current={run.id === activeId ? 'true' : undefined}
                  onClick={() => onOpen(run.id)}
                >
                  <span className="session-name">{run.studentName ?? run.filename}</span>
                  <span className="session-score">
                    {run.awardedMarks}
                    <span> / {run.maxMarks}</span>
                  </span>
                  <span className="session-go">
                    <Chevron size={14} />
                  </span>
                  <span className="session-meta">
                    <span>{new Date(run.createdAt).toLocaleString()}</span>
                    {run.needsHumanReview && (
                      <>
                        <span className="sep">·</span>
                        <span className="session-flag">needs review</span>
                      </>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

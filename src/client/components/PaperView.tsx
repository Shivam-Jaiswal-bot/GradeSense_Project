/**
 * The answer paper with its annotation layer.
 *
 * The pages are rendered from the original PDF by pdf.js; the annotations are
 * absolutely positioned over them. Dragging or resizing one edits only that
 * annotation - the marks and the grading behind them never move.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as pdfjs from 'pdfjs-dist';
import { Alert } from './icons.js';
import type { Annotation, PageGeometry } from '../../shared/types.js';

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

const SCALE = 1.35;
const MIN_SIZE = 12;

interface Props {
  documentUrl: string;
  pages: PageGeometry[];
  annotations: Annotation[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onChange: (id: string, patch: Partial<Annotation>) => void;
  onAddNote: (page: number, x: number, y: number) => void;
}

type DragState = {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  origin: { x: number; y: number; width: number; height: number };
};

export function PaperView({
  documentUrl,
  pages,
  annotations,
  selectedId,
  onSelect,
  onChange,
  onAddNote,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendered, setRendered] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const [dragging, setDragging] = useState(false);
  // The live drag lives in a ref and is mirrored into state for rendering, so
  // the position that gets saved never depends on a render having happened.
  const previewRef = useRef<Record<string, Partial<Annotation>>>({});
  const [preview, setPreview] = useState<Record<string, Partial<Annotation>>>({});

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;
    container.querySelectorAll('canvas').forEach((canvas) => canvas.remove());
    setRendered(false);
    setError(null);

    (async () => {
      const task = pdfjs.getDocument({ url: documentUrl });
      try {
        const doc = await task.promise;
        for (let number = 1; number <= doc.numPages; number++) {
          if (cancelled) break;
          const page = await doc.getPage(number);
          const viewport = page.getViewport({ scale: SCALE });
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.className = 'page-canvas';
          const holder = container.querySelector<HTMLDivElement>(`[data-page="${number}"]`);
          holder?.prepend(canvas);
          const context = canvas.getContext('2d');
          if (context) await page.render({ canvas, canvasContext: context, viewport }).promise;
        }
        if (!cancelled) setRendered(true);
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        await task.destroy();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [documentUrl, pages.length]);

  /* ------------------------- dragging and resizing ------------------------ */

  // The listeners are attached when the drag starts rather than by an effect:
  // an effect runs after the next render, and a quick drag can be over by then.
  const detachRef = useRef<(() => void) | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => () => detachRef.current?.(), []);

  const finishDrag = useCallback(() => {
    const state = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    detachRef.current?.();
    detachRef.current = null;
    if (!state) return;

    const patch = previewRef.current[state.id];
    const { [state.id]: _dropped, ...rest } = previewRef.current;
    previewRef.current = rest;
    setPreview(rest);
    if (patch) onChangeRef.current(state.id, patch);
  }, []);

  const startDrag = (
    event: React.PointerEvent,
    annotation: Annotation,
    mode: DragState['mode'],
  ) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect(annotation.id);

    const state: DragState = {
      id: annotation.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      origin: {
        x: annotation.x,
        y: annotation.y,
        width: annotation.width,
        height: annotation.height,
      },
    };
    dragRef.current = state;
    setDragging(true);

    const move = (moveEvent: PointerEvent) => {
      const dx = (moveEvent.clientX - state.startX) / SCALE;
      // Screen y grows downward, PDF y grows upward.
      const dy = -(moveEvent.clientY - state.startY) / SCALE;
      previewRef.current = {
        ...previewRef.current,
        [state.id]:
          state.mode === 'move'
            ? { x: state.origin.x + dx, y: state.origin.y + dy }
            : {
                x: state.origin.x,
                y: Math.min(state.origin.y + dy, state.origin.y + state.origin.height - MIN_SIZE),
                width: Math.max(MIN_SIZE, state.origin.width + dx),
                height: Math.max(MIN_SIZE, state.origin.height - dy),
              },
      };
      setPreview(previewRef.current);
    };

    detachRef.current?.();
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finishDrag);
    window.addEventListener('pointercancel', finishDrag);
    detachRef.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', finishDrag);
      window.removeEventListener('pointercancel', finishDrag);
    };
  };

  const addHere = (event: React.MouseEvent, page: PageGeometry) => {
    if (!event.altKey) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / SCALE;
    const y = page.height - (event.clientY - bounds.top) / SCALE;
    onAddNote(page.page, x, y);
  };

  return (
    <div
      className={`paper${dragging ? ' dragging' : ''}`}
      ref={containerRef}
      onPointerDown={() => onSelect(null)}
    >
      {error && (
        <p className="paper-status is-error" role="alert">
          <Alert size={15} />
          The paper could not be displayed: {error}
        </p>
      )}
      {!rendered && !error && (
        <p className="paper-status">
          <span className="spinner" />
          Rendering the answer paper…
        </p>
      )}

      {pages.map((page) => (
        <div
          key={page.page}
          className="page"
          data-page={page.page}
          style={{ width: page.width * SCALE, height: page.height * SCALE }}
          onClick={(event) => addHere(event, page)}
        >
          {annotations
            .filter((annotation) => annotation.page === page.page)
            .map((annotation) => {
              const patched = { ...annotation, ...preview[annotation.id] };
              const selected = annotation.id === selectedId;
              return (
                <div
                  key={annotation.id}
                  className={[
                    'annotation',
                    `style-${patched.style}`,
                    `severity-${patched.severity}`,
                    selected ? 'selected' : '',
                    patched.anchored ? '' : 'unanchored',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={{
                    left: patched.x * SCALE,
                    top: (page.height - patched.y - patched.height) * SCALE,
                    width: patched.width * SCALE,
                    height: patched.height * SCALE,
                  }}
                  title={patched.text}
                  onPointerDown={(event) => startDrag(event, patched, 'move')}
                >
                  {patched.style === 'note' && <span className="note-text">{patched.text}</span>}
                  {patched.marksLost > 0 && <span className="marks">-{patched.marksLost}</span>}
                  {selected && (
                    <span
                      className="handle"
                      onPointerDown={(event) => startDrag(event, patched, 'resize')}
                    />
                  )}
                </div>
              );
            })}
        </div>
      ))}
    </div>
  );
}

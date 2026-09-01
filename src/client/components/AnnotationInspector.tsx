/**
 * Editing panel for one annotation. Everything here writes to the annotation
 * only: the marks stay exactly as they were graded.
 */

import { useEffect, useState } from 'react';
import { Cursor } from './icons.js';
import type { Annotation } from '../../shared/types.js';

const STYLES: Annotation['style'][] = ['box', 'underline', 'strikethrough', 'note'];
const SEVERITIES: Annotation['severity'][] = ['error', 'warning', 'info'];

interface Props {
  annotation: Annotation | null;
  onChange: (id: string, patch: Partial<Annotation>) => void;
  onDelete: (id: string) => void;
}

export function AnnotationInspector({ annotation, onChange, onDelete }: Props) {
  const [text, setText] = useState(annotation?.text ?? '');

  useEffect(() => {
    setText(annotation?.text ?? '');
  }, [annotation?.id, annotation?.text]);

  if (!annotation) {
    return (
      <div className="card inspector">
        <div className="inspector-empty">
          <Cursor size={15} />
          <p>
            Select a mark on the paper to edit it, or <kbd>Alt</kbd> + click anywhere on a page to
            add a new note.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card inspector">
      <header className="inspector-head">
        <h2 className="card-title">Annotation</h2>
        {annotation.edited && <span className="pill">edited</span>}
        {!annotation.anchored && (
          <span
            className="pill tone-warn"
            title="The quoted text could not be located on the page"
          >
            placed in margin
          </span>
        )}
      </header>

      <div className="inspector-body">
        <label className="field">
          <span>Comment</span>
          <textarea
            className="textarea"
            value={text}
            rows={4}
            maxLength={2000}
            onChange={(event) => setText(event.target.value)}
            onBlur={() => text !== annotation.text && onChange(annotation.id, { text })}
          />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Style</span>
            <select
              className="select"
              value={annotation.style}
              onChange={(event) =>
                onChange(annotation.id, { style: event.target.value as Annotation['style'] })
              }
            >
              {STYLES.map((style) => (
                <option key={style} value={style}>
                  {style}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Severity</span>
            <select
              className="select"
              value={annotation.severity}
              onChange={(event) =>
                onChange(annotation.id, {
                  severity: event.target.value as Annotation['severity'],
                })
              }
            >
              {SEVERITIES.map((severity) => (
                <option key={severity} value={severity}>
                  {severity}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="inspector-position">
          <span>page {annotation.page}</span>
          <span>
            x {annotation.x.toFixed(0)}, y {annotation.y.toFixed(0)}
          </span>
          <span>
            {annotation.width.toFixed(0)} × {annotation.height.toFixed(0)}
          </span>
          {annotation.marksLost > 0 && <span>costs {annotation.marksLost} mark(s)</span>}
        </p>

        <button type="button" className="btn btn-danger" onClick={() => onDelete(annotation.id)}>
          Delete annotation
        </button>
      </div>
    </div>
  );
}

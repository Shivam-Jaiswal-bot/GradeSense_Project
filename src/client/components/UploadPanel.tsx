/** Upload the three papers and start a grading run. */

import { useRef, useState } from 'react';
import { Alert, Close, FilePdf, Sparkle, Swap, UploadCloud } from './icons.js';
import { useGradingStage } from './EmptyState.js';

interface Props {
  busy: boolean;
  onSubmit: (files: {
    studentAnswer: File;
    modelAnswer: File;
    questionPaper?: File | null;
    studentName?: string;
  }) => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

function isPdf(file: File): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

export function UploadPanel({ busy, onSubmit }: Props) {
  const [questionPaper, setQuestionPaper] = useState<File | null>(null);
  const [modelAnswer, setModelAnswer] = useState<File | null>(null);
  const [studentAnswer, setStudentAnswer] = useState<File | null>(null);
  const [studentName, setStudentName] = useState('');

  const stage = useGradingStage(busy);
  const ready = Boolean(modelAnswer && studentAnswer) && !busy;

  const missing = [
    modelAnswer ? null : 'a model answer',
    studentAnswer ? null : 'a student answer',
  ].filter(Boolean);

  return (
    <form
      className="card upload"
      onSubmit={(event) => {
        event.preventDefault();
        if (!modelAnswer || !studentAnswer) return;
        onSubmit({ studentAnswer, modelAnswer, questionPaper, studentName: studentName.trim() });
      }}
    >
      <div className="card-head">
        <h2 className="card-title">Start a grading session</h2>
        <p className="card-sub">
          Drop in the marking scheme and the paper to grade. PDFs only.
        </p>
      </div>

      <div className="upload-body">
        <DropField
          id="gs-question"
          label="Question paper"
          hint="Helps the grader read the question wording."
          file={questionPaper}
          onPick={setQuestionPaper}
          disabled={busy}
        />
        <DropField
          id="gs-model"
          label="Model answer / rubric"
          hint="The marking scheme is read from this."
          required
          file={modelAnswer}
          onPick={setModelAnswer}
          disabled={busy}
        />
        <DropField
          id="gs-student"
          label="Student answer"
          hint="The paper to be graded and annotated."
          required
          file={studentAnswer}
          onPick={setStudentAnswer}
          disabled={busy}
        />

        <div className="drop-field">
          <div className="field-head">
            <label className="field-label" htmlFor="gs-name">
              Student name
            </label>
            <span className="req">Optional</span>
          </div>
          <input
            id="gs-name"
            className="text-input"
            type="text"
            value={studentName}
            maxLength={120}
            disabled={busy}
            onChange={(event) => setStudentName(event.target.value)}
            placeholder="e.g. Ananya Sharma"
          />
        </div>
      </div>

      <div className="upload-foot">
        <button type="submit" className="btn btn-primary btn-block" disabled={!ready}>
          {busy ? (
            <>
              <span className="spinner" />
              <span>{stage.label}</span>
            </>
          ) : (
            <>
              <Sparkle size={15} />
              <span>Grade paper</span>
            </>
          )}
        </button>

        {busy ? (
          <div
            className="progress"
            role="progressbar"
            aria-label="Grading progress"
            aria-valuetext={stage.label}
          >
            <div className="progress-bar" style={{ width: `${stage.percent}%` }} />
          </div>
        ) : (
          <p className={`upload-note${ready ? ' is-ready' : ''}`}>
            {missing.length ? `Still need ${missing.join(' and ')}.` : 'Ready to grade.'}
          </p>
        )}
      </div>
    </form>
  );
}

function DropField({
  id,
  label,
  hint,
  required = false,
  file,
  onPick,
  disabled,
}: {
  id: string;
  label: string;
  hint: string;
  required?: boolean;
  file: File | null;
  onPick: (file: File | null) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [focused, setFocused] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  /** One gate for both the picker and a drop, so neither can smuggle in a non-PDF. */
  const accept = (picked: File | null | undefined) => {
    if (!picked) return;
    if (!isPdf(picked)) {
      setRejected(`"${picked.name}" is not a PDF.`);
      return;
    }
    setRejected(null);
    onPick(picked);
  };

  const clear = () => {
    setRejected(null);
    onPick(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div
      className={[
        'drop-field',
        over ? 'is-over' : '',
        disabled ? 'is-disabled' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onDragOver={(event) => {
        if (disabled) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setOver(false);
      }}
      onDrop={(event) => {
        if (disabled) return;
        event.preventDefault();
        setOver(false);
        accept(event.dataTransfer.files?.[0]);
      }}
    >
      <div className="field-head">
        <span className="field-label" id={`${id}-label`}>
          {label}
        </span>
        <span className={`req${required ? ' is-required' : ''}`}>
          {required ? 'Required' : 'Optional'}
        </span>
      </div>
      <p className="field-hint" id={`${id}-hint`}>
        {hint}
      </p>

      {/* The input stays mounted so the picker keeps its value; it is the tab
          stop only while the zone is empty, otherwise the chip buttons are. */}
      <input
        ref={inputRef}
        id={id}
        className="sr-only"
        type="file"
        accept="application/pdf,.pdf"
        disabled={disabled}
        tabIndex={file ? -1 : 0}
        aria-labelledby={`${id}-label`}
        aria-describedby={`${id}-hint`}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => accept(event.target.files?.[0] ?? null)}
      />

      {file ? (
        <div className="file-chip">
          <span className="file-icon">
            <FilePdf size={15} />
          </span>
          <span className="file-meta">
            <span className="file-name" title={file.name}>
              {file.name}
            </span>
            <span className="file-sub">PDF · {formatBytes(file.size)}</span>
          </span>
          <span className="file-actions">
            <button
              type="button"
              className="icon-btn"
              disabled={disabled}
              title="Replace this file"
              aria-label={`Replace ${label}`}
              onClick={() => inputRef.current?.click()}
            >
              <Swap size={14} />
            </button>
            <button
              type="button"
              className="icon-btn danger"
              disabled={disabled}
              title="Remove this file"
              aria-label={`Remove ${label}`}
              onClick={clear}
            >
              <Close size={14} />
            </button>
          </span>
        </div>
      ) : (
        <label className={`dropzone${focused ? ' is-focus' : ''}`} htmlFor={id}>
          <span className="dz-icon">
            <UploadCloud size={16} />
          </span>
          <span className="dz-copy">
            <span className="dz-main">
              Drag &amp; drop or <b>browse</b>
            </span>
            <span className="dz-sub">PDF only</span>
          </span>
        </label>
      )}

      {rejected && (
        <p className="field-error" role="alert">
          <Alert size={13} />
          {rejected}
        </p>
      )}
    </div>
  );
}

/** The marks, the evidence behind each one, and what the grader is unsure of. */

import { Alert, Quote } from './icons.js';
import type { CriterionResult, GradingRun, QuestionResult } from '../../shared/types.js';

const STATUS_LABEL: Record<CriterionResult['status'], string> = {
  correct: 'correct',
  partial: 'partial',
  missing: 'missing',
  incorrect: 'incorrect',
};

function confidenceClass(confidence: number): string {
  if (confidence >= 0.7) return 'high';
  if (confidence >= 0.45) return 'medium';
  return 'low';
}

/** Shared banding for the score ring and the per-question meters. */
export function scoreTone(awarded: number, max: number): 'ok' | 'mid' | 'low' {
  const ratio = max > 0 ? awarded / max : 0;
  if (ratio >= 0.75) return 'ok';
  if (ratio >= 0.45) return 'mid';
  return 'low';
}

export function percentOf(awarded: number, max: number): number {
  return max > 0 ? Math.round((awarded / max) * 100) : 0;
}

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function ScoreRing({ awarded, max }: { awarded: number; max: number }) {
  const percent = percentOf(awarded, max);
  const filled = Math.max(0, Math.min(1, max > 0 ? awarded / max : 0));

  return (
    <div className={`ring tone-${scoreTone(awarded, max)}`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle className="ring-track" cx="50" cy="50" r={RADIUS} />
        <circle
          className="ring-value"
          cx="50"
          cy="50"
          r={RADIUS}
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - filled)}
        />
      </svg>
      <div className="ring-label">
        <span className="ring-pct">
          {percent}
          <i>%</i>
        </span>
        <span className="ring-marks">
          {awarded} / {max}
        </span>
      </div>
      <span className="sr-only">
        {awarded} out of {max} marks, {percent} percent.
      </span>
    </div>
  );
}

export function ScorePanel({ run }: { run: GradingRun }) {
  const confidence = Math.round(run.confidence * 100);

  return (
    <div className="card score-panel">
      <div className="score-hero">
        <ScoreRing awarded={run.awardedMarks} max={run.maxMarks} />
        <div className="hero-side">
          <h2>{run.studentName ?? 'Overall score'}</h2>
          <div className="hero-pills">
            <span className={`pill tone-${confidenceClass(run.confidence) === 'high' ? 'ok' : confidenceClass(run.confidence) === 'medium' ? 'warn' : 'err'}`}>
              {confidence}% confidence
            </span>
            {run.needsHumanReview ? (
              <span className="pill tone-warn">Needs review</span>
            ) : (
              <span className="pill tone-ok">Auto-graded</span>
            )}
            {run.degraded && <span className="pill tone-warn">Fallback used</span>}
          </div>
          <p className="hero-note">
            {run.provider} · {run.model} · {run.durationMs} ms
          </p>
        </div>
      </div>

      <p className="claim">
        <Quote size={14} />
        <span>
          <strong>Every mark is evidenced.</strong> Each criterion below quotes the words in the
          answer that earned or lost it.
        </span>
      </p>

      {run.needsHumanReview && (
        <div className="review">
          <p className="review-head">
            <Alert size={14} />
            Needs human review
          </p>
          <ul>
            {run.reviewReasons.map((reason) => (
              <li key={reason}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="breakdown">
        <h3 className="breakdown-head">
          Mark breakdown
          <span>
            {run.questions.length} question{run.questions.length === 1 ? '' : 's'}
          </span>
        </h3>
        {run.questions.map((question) => (
          <QuestionBlock key={question.questionId} question={question} />
        ))}
      </div>

      {run.adjustments.length > 0 && (
        <details className="adjustments">
          <summary>{run.adjustments.length} automatic correction(s) to the model output</summary>
          <ul>
            {run.adjustments.map((adjustment) => (
              <li key={adjustment}>{adjustment}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function QuestionBlock({ question }: { question: QuestionResult }) {
  return (
    <section className="question">
      <div className="question-head">
        <div className="question-title">
          <h3>Q{question.number}</h3>
          <span className="question-subject">{question.subject}</span>
          <span className="question-marks">
            {question.awardedMarks} <span>/ {question.maxMarks}</span>
          </span>
        </div>
        <div className="meter">
          <div
            className={`meter-fill tone-${scoreTone(question.awardedMarks, question.maxMarks)}`}
            style={{ width: `${percentOf(question.awardedMarks, question.maxMarks)}%` }}
          />
        </div>
        <p className="question-summary">{question.summary}</p>
      </div>

      <div className="criteria">
        {question.criteria.map((criterion) => (
          <CriterionBlock key={criterion.criterionId} criterion={criterion} />
        ))}
      </div>
    </section>
  );
}

function CriterionBlock({ criterion }: { criterion: CriterionResult }) {
  const confidence = Math.round(criterion.confidence * 100);

  return (
    <article className={`criterion ${criterion.status}`}>
      <header className="criterion-head">
        <span className={`status ${criterion.status}`}>{STATUS_LABEL[criterion.status]}</span>
        <span className={`conf ${confidenceClass(criterion.confidence)}`}>
          <span className="conf-track">
            <span className="conf-fill" style={{ width: `${confidence}%` }} />
          </span>
          {confidence}%
        </span>
        <span className="criterion-marks">
          {criterion.awardedMarks} <span>/ {criterion.maxMarks}</span>
        </span>
      </header>

      <p className="criterion-desc">{criterion.description}</p>

      {criterion.evidence.length > 0 && (
        <div className="evidence">
          <p className="evidence-head">
            <Quote size={11} />
            Evidence from the answer
          </p>
          {criterion.evidence.map((evidence, index) => (
            <div className="evidence-quote" key={`${evidence.offset}-${index}`}>
              <q>{evidence.quote}</q>
              {evidence.page ? <span className="evidence-page">p{evidence.page}</span> : null}
            </div>
          ))}
        </div>
      )}

      {criterion.feedback && (
        <p className="criterion-line">
          <b>Feedback</b>
          <span>{criterion.feedback}</span>
        </p>
      )}
      {criterion.correction && (
        <p className="criterion-line correction">
          <b>Should say</b>
          <span>{criterion.correction}</span>
        </p>
      )}
      {criterion.adjustments.length > 0 && (
        <ul className="criterion-adjustments">
          {criterion.adjustments.map((adjustment) => (
            <li key={adjustment}>{adjustment}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

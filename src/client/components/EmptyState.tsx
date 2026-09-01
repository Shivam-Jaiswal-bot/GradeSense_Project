/**
 * What fills the workspace before a run exists: the onboarding state, and the
 * staged progress shown while a paper is being graded.
 *
 * The stages are a progress indicator, not a report from the server - grading
 * is a single request - so the last one holds until the response lands.
 */

import { useEffect, useState } from 'react';
import { Check, LogoGlyph, Quote, Sparkle, Target } from './icons.js';

export const GRADING_STAGES = [
  'Reading the answer…',
  'Applying the rubric…',
  'Generating explanations…',
  'Finalising the grade…',
] as const;

const STAGE_MS = 1600;

export interface GradingStage {
  index: number;
  label: string;
  percent: number;
}

/** Walks the stage labels while `active`, and resets the moment it clears. */
export function useGradingStage(active: boolean): GradingStage {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setIndex(0);
      return;
    }
    const timer = setInterval(
      () => setIndex((current) => Math.min(current + 1, GRADING_STAGES.length - 1)),
      STAGE_MS,
    );
    return () => clearInterval(timer);
  }, [active]);

  return {
    index,
    label: GRADING_STAGES[index] ?? GRADING_STAGES[0],
    // Never reaches 100%: the run is only done when the response arrives.
    percent: ((index + 1) / (GRADING_STAGES.length + 1)) * 100,
  };
}

const FEATURES = [
  {
    icon: <Quote size={14} />,
    title: 'Explainable marks',
    body: 'Every mark is tied to specific evidence in the answer.',
  },
  {
    icon: <Target size={14} />,
    title: 'Question-level feedback',
    body: 'See exactly where marks were earned or lost.',
  },
  {
    icon: <Check size={14} />,
    title: 'Consistent grading',
    body: 'Apply the same rubric across student answers.',
  },
];

export function EmptyState() {
  return (
    <div className="card onboard">
      <div className="onboard-glyph">
        <LogoGlyph size={30} />
      </div>
      <h2>Ready to grade?</h2>
      <p className="onboard-lede">
        Upload a rubric and a student answer to get an explainable, question-by-question
        assessment — with the words in the answer that earned or lost each mark.
      </p>

      <div className="onboard-features">
        {FEATURES.map((feature, index) => (
          <article
            className="feature"
            key={feature.title}
            style={{ animationDelay: `${120 + index * 80}ms` }}
          >
            <span className="feature-icon">{feature.icon}</span>
            <h3>{feature.title}</h3>
            <p>{feature.body}</p>
          </article>
        ))}
      </div>

      <p className="onboard-hint">
        Marks and annotations stay separate — editing a mark on the paper never re-runs grading.
      </p>
    </div>
  );
}

export function GradingProgress() {
  const stage = useGradingStage(true);

  return (
    <div className="card grading" aria-live="polite">
      <div className="grading-orb">
        <Sparkle size={22} />
      </div>
      <h2>Grading the paper</h2>
      <p>Reading the answer against the rubric, one criterion at a time.</p>

      <ol className="stages">
        {GRADING_STAGES.map((label, index) => {
          const state = index < stage.index ? 'is-done' : index === stage.index ? 'is-now' : '';
          return (
            <li className={`stage ${state}`} key={label}>
              <span className="stage-dot">{index < stage.index && <Check size={10} />}</span>
              {label}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

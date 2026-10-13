import { LIFECYCLE_STEPS } from './fields.js';

// The phases an employee moves through, left to right.
// `current` highlights one step; with no employee loaded, none is highlighted.
export default function LifecycleTimeline({ current }) {
  return (
    <ol className="timeline" aria-label="Employee lifecycle phases">
      {LIFECYCLE_STEPS.map((step) => {
        const isCurrent = step === current;
        return (
          <li
            key={step}
            className={`timeline__step${isCurrent ? ' timeline__step--current' : ''}`}
            aria-current={isCurrent ? 'step' : undefined}
          >
            <span className="timeline__marker" aria-hidden="true" />
            <span className="timeline__label">{step}</span>
          </li>
        );
      })}
    </ol>
  );
}

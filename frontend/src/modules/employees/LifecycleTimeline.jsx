import { LIFECYCLE_STEPS, PHASES } from './fields.js';

// What each step means for one employee: 'done', 'current', 'exited' (left
// during this phase) or 'future'. Only recorded decisions count as done; no
// date is ever guessed.
function stepStates(employee, phases) {
  const passed = new Set(phases.filter((p) => p.result === 'pass').map((p) => p.phase));
  const active = employee.status === 'active';
  return {
    Joined: 'done',
    ...Object.fromEntries(
      PHASES.map((phase, index) => {
        const label = LIFECYCLE_STEPS[index + 1];
        if (passed.has(phase)) return [label, 'done'];
        if (employee.currentPhase === phase) return [label, active ? 'current' : 'exited'];
        return [label, 'future'];
      }),
    ),
  };
}

const STATE_TEXT = { done: 'completed', current: 'current', exited: 'left here', future: '' };

// The phases an employee moves through, left to right.
//   current:            highlights one step (the phase pages), with no employee
//   employee + phases:  marks each step as completed, current, left or to come
export default function LifecycleTimeline({ current, employee, phases = [] }) {
  const states = employee ? stepStates(employee, phases) : null;

  return (
    <ol className="timeline" aria-label="Employee lifecycle phases">
      {LIFECYCLE_STEPS.map((step) => {
        const state = states ? states[step] : step === current ? 'current' : 'future';
        return (
          <li
            key={step}
            className={`timeline__step timeline__step--${state}`}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="timeline__marker" aria-hidden="true" />
            <span className="timeline__label">{step}</span>
            {states && STATE_TEXT[state] && (
              <span className="timeline__state">{STATE_TEXT[state]}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

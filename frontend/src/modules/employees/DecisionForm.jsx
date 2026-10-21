import { useState } from 'react';
import FormField from '../../components/FormField.jsx';
import Notice from '../../components/Notice.jsx';
import { formatDate } from '../../utils/format.js';
import { recordDecision, recordTermination } from './api.js';
import { PHASE_LABELS, RESULT_LABELS } from './fields.js';

const EMPTY = { result: '', endDate: '', exitDate: '', reason: '', reviewDocUrl: '' };
// These Evaluation labels have no approved lifecycle values or server mapping.
// They are shown as selectable drafts only; the save handler rejects them.
const EVALUATION_DRAFTS = [
  { value: 'draft_external', label: 'External' },
  { value: 'draft_reject', label: 'Reject' },
  { value: 'draft_probation', label: 'Probation' },
];

// Turns a save answer into a message, or field errors for a 422.
async function submit(call, { setErrors, setFailure }) {
  let res;
  try {
    res = await call();
  } catch {
    res = null;
  }
  if (res?.ok) return res;
  if (res?.status === 422) {
    setErrors(res.body.fields ?? {});
    setFailure('Some fields need correcting. Nothing was saved.');
  } else if (res?.status === 403) {
    setFailure('You do not have permission to manage employees.');
  } else {
    setFailure('This could not be saved. Check your connection and try again.');
  }
  return null;
}

// The gate decision on the current phase, as the task guide allows it:
// evaluation Pass or Discontinue; probation Pass, Extend or Discontinue;
// junior Pass or Discontinue.
export default function DecisionForm({ employeeId, decision, onSaved }) {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [saving, setSaving] = useState(false);
  const phase = PHASE_LABELS[decision.phase];
  const allowedResults = decision.allowedResults;
  const draftOptions = decision.phase === 'evaluation' ? EVALUATION_DRAFTS : [];
  const decisionOptions = [
    ...allowedResults.map((value) => ({ value, label: RESULT_LABELS[value] })),
    ...draftOptions,
  ];
  const selectedDraft = draftOptions.find((option) => option.value === values.result);

  const set = (name, value) => {
    setValues((old) => ({ ...old, [name]: value }));
    setErrors((old) => ({ ...old, [name]: undefined }));
  };
  const field = (name) => ({
    name,
    value: values[name],
    onChange: (event) => set(name, event.target.value),
    disabled: saving,
    error: errors[name],
  });

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    setFailure(null);
    if (selectedDraft) {
      setFailure(
        `${selectedDraft.label} is a draft only. An approved lifecycle rule is required before it can be saved.`,
      );
      return;
    }
    const problems = {};
    if (!values.result) problems.result = 'Choose a decision.';
    if (values.result === 'discontinue') {
      if (!values.reason.trim()) problems.reason = 'A reason is required to discontinue.';
      if (!values.exitDate) problems.exitDate = 'Exit date is required.';
    }
    if (values.result === 'extend' && !values.endDate) {
      problems.endDate = 'Extended end date is required.';
    }
    if (values.result === 'pass' && decision.needsEndDate && !values.endDate) {
      problems.endDate = 'Junior end date is required.';
    }
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setSaving(true);
    const res = await submit(
      () =>
        recordDecision(employeeId, {
          result: values.result,
          endDate: values.endDate || null,
          exitDate: values.result === 'discontinue' ? values.exitDate : null,
          reason: values.reason,
          reviewDocUrl: values.reviewDocUrl,
        }),
      { setErrors, setFailure },
    );
    setSaving(false);
    if (res) {
      const { employee } = res.body;
      onSaved(
        employee.status === 'active'
          ? `Decision recorded. Current phase: ${PHASE_LABELS[employee.currentPhase]}.`
          : 'Decision recorded. The employee is now Discontinued.',
      );
    }
  }

  return (
    <form className="panel" onSubmit={save} noValidate aria-labelledby="decision-title">
      <h2 id="decision-title" className="panel__title">
        {phase} decision
      </h2>
      {failure && (
        <Notice tone="danger" role="alert">
          {failure}
        </Notice>
      )}
      <div className="form-grid">
        <FormField
          label="Decision"
          type="select"
          required
          options={decisionOptions}
          emptyLabel="Select..."
          hint={
            selectedDraft
              ? `${selectedDraft.label} is an unsaved draft; its lifecycle mapping is not approved.`
              : decision.phase === 'junior'
                ? 'Pass starts the senior phase the day after the junior end date.'
                : `Pass starts the next phase the day after the ${phase.toLowerCase()} ends.`
          }
          {...field('result')}
        />
        {values.result === 'extend' && (
          <FormField
            label="Extended end date"
            type="date"
            required
            max={decision.extensionLatestEnd ?? undefined}
            hint={`Probation can be extended by up to one month: to ${formatDate(decision.extensionLatestEnd)} at the latest.`}
            {...field('endDate')}
          />
        )}
        {values.result === 'pass' && decision.needsEndDate && (
          <FormField
            label="Junior end date"
            type="date"
            required
            hint="This junior phase has no stored end date (it was created before the end date was calculated). Enter the date it ended."
            {...field('endDate')}
          />
        )}
        {values.result === 'discontinue' && (
          <FormField label="Exit date" type="date" required {...field('exitDate')} />
        )}
        {(values.result === 'discontinue' || values.result === 'extend') && (
          <FormField
            label={values.result === 'discontinue' ? 'Reason' : 'Reason for extension'}
            type="textarea"
            wide
            required={values.result === 'discontinue'}
            maxLength={1000}
            {...field('reason')}
          />
        )}
        <FormField
          label="Review document link"
          type="url"
          wide
          maxLength={500}
          hint="Optional. A link to the review form or document."
          {...field('reviewDocUrl')}
        />
      </div>
      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={saving}>
          {saving ? 'Saving…' : 'Record decision'}
        </button>
      </div>
    </form>
  );
}

// "Terminated = employment ended by the company after confirmation": only
// offered once probation has passed (the guide's working definition).
export function TerminationForm({ employeeId, onSaved }) {
  const [values, setValues] = useState({ exitDate: '', reason: '' });
  const [errors, setErrors] = useState({});
  const [failure, setFailure] = useState(null);
  const [saving, setSaving] = useState(false);

  const field = (name) => ({
    name,
    value: values[name],
    onChange: (event) => {
      const { value } = event.target;
      setValues((old) => ({ ...old, [name]: value }));
      setErrors((old) => ({ ...old, [name]: undefined }));
    },
    disabled: saving,
    error: errors[name],
  });

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    const problems = {};
    if (!values.exitDate) problems.exitDate = 'Exit date is required.';
    if (!values.reason.trim()) problems.reason = 'A reason is required.';
    setErrors(problems);
    setFailure(null);
    if (Object.keys(problems).length > 0) return;

    setSaving(true);
    const res = await submit(() => recordTermination(employeeId, values), {
      setErrors,
      setFailure,
    });
    setSaving(false);
    if (res) onSaved('Termination recorded.');
  }

  return (
    <form className="panel" onSubmit={save} noValidate aria-labelledby="termination-title">
      <h2 id="termination-title" className="panel__title">
        End employment (Terminated)
      </h2>
      <p className="panel__note">
        For employment ended by the company after probation has passed. This definition is waiting
        for mentor confirmation.
      </p>
      {failure && (
        <Notice tone="danger" role="alert">
          {failure}
        </Notice>
      )}
      <div className="form-grid">
        <FormField label="Termination date" type="date" required {...field('exitDate')} />
        <FormField
          label="Termination reason"
          type="textarea"
          wide
          required
          maxLength={1000}
          {...field('reason')}
        />
      </div>
      <div className="form-actions">
        <button type="submit" className="button" disabled={saving}>
          {saving ? 'Saving…' : 'Record termination'}
        </button>
      </div>
    </form>
  );
}

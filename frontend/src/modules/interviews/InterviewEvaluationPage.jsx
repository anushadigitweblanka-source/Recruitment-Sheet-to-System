import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import CandidateSummary from '../../components/CandidateSummary.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import FormField from '../../components/FormField.jsx';
import FormPanel from '../../components/FormPanel.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { fromOfficeInput, toOfficeInput } from '../../utils/format.js';
import { getPhoneInterview } from '../phone-interviews/api.js';
import { createInterview, getInterview, updateInterview } from './api.js';
import { ATTENDANCE_OPTIONS, DECISION_OPTIONS } from './fields.js';
import {
  MAX_SCORE,
  MAX_TOTAL,
  MIN_SCORE,
  SCORE_CRITERIA,
  calculateTotal,
  isValidScore,
} from './scoring.js';

const EMPTY_SCORES = Object.fromEntries(SCORE_CRITERIA.map((criterion) => [criterion.name, '']));
const EMPTY_VALUES = {
  scheduledAt: '',
  attendance: '',
  interviewerName: '',
  ...EMPTY_SCORES,
  decision: '',
  holdReason: '',
  nextFollowupDate: '',
  rejectReason: '',
  remarks: '',
};

const NOTHING = async () => ({ ok: true, status: 200, body: null });
const text = (value) => (value === null || value === undefined ? '' : String(value));

// What the form starts with: an existing interview, or for a new one the slot
// that was agreed in the phone interview.
function toFormValues(data, isNew) {
  if (isNew) {
    return { ...EMPTY_VALUES, scheduledAt: toOfficeInput(data.phoneScreen?.interviewAt) };
  }
  const { interview } = data;
  return {
    scheduledAt: toOfficeInput(interview.scheduledAt),
    attendance: text(interview.attendance),
    interviewerName: text(interview.interviewerName),
    ...Object.fromEntries(SCORE_CRITERIA.map((c) => [c.name, text(interview[c.name])])),
    decision: text(interview.decision),
    holdReason: text(data.holdReason),
    nextFollowupDate: text(data.nextFollowupDate),
    rejectReason: text(data.rejectReason),
    remarks: text(interview.remarks),
  };
}

// Quick checks for convenience. The backend checks everything again.
function validate(values) {
  const errors = {};
  if (!values.scheduledAt) errors.scheduledAt = 'Interview Date/Time is required.';

  const entered = SCORE_CRITERIA.filter((criterion) => values[criterion.name] !== '');
  for (const criterion of entered) {
    if (!isValidScore(values[criterion.name])) {
      errors[criterion.name] =
        `${criterion.label} must be a whole number from ${MIN_SCORE} to ${MAX_SCORE}.`;
    }
  }
  if (entered.length > 0 && entered.length < SCORE_CRITERIA.length) {
    for (const criterion of SCORE_CRITERIA) {
      if (values[criterion.name] === '') {
        errors[criterion.name] = `${criterion.label} is missing. Enter all five scores or none.`;
      }
    }
  }

  if (values.decision) {
    if (values.attendance !== 'attended') {
      errors.attendance = 'Mark the candidate as Attended before choosing a status.';
    }
    if (entered.length === 0) errors.decision = 'Enter all five scores before choosing a status.';
  }
  if (values.decision === 'on_hold' && !values.holdReason.trim()) {
    errors.holdReason = 'A reason for hold is required when the status is On Hold.';
  }
  if (values.decision === 'not_selected' && !values.rejectReason.trim()) {
    errors.rejectReason = 'A reason for rejection is required when the status is Not Selected.';
  }
  return errors;
}

function toPayload(values) {
  return {
    scheduledAt: fromOfficeInput(values.scheduledAt),
    attendance: values.attendance || null,
    interviewerName: values.interviewerName,
    ...Object.fromEntries(
      SCORE_CRITERIA.map((c) => [c.name, values[c.name] === '' ? null : Number(values[c.name])]),
    ),
    decision: values.decision || null,
    holdReason: values.holdReason,
    nextFollowupDate: values.nextFollowupDate || null,
    rejectReason: values.rejectReason,
    remarks: values.remarks,
  };
}

// Scores a direct interview and records the decision.
//   /interviews/new?candidate=12   a first evaluation for candidate 12
//   /interviews/7/evaluate         changes interview 7
export default function InterviewEvaluationPage({ page }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isNew = !id;
  const candidateId = isNew ? searchParams.get('candidate') : null;

  const loaded = useApi(() => {
    if (!isNew) return getInterview(id);
    return candidateId ? getPhoneInterview(candidateId) : NOTHING();
  }, [id, candidateId]);

  const [values, setValues] = useState(EMPTY_VALUES);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (loaded.status === 'ready' && loaded.data) setValues(toFormValues(loaded.data, isNew));
  }, [loaded.status, loaded.data, isNew]);

  function set(name, value) {
    setValues((old) => {
      const next = { ...old, [name]: value };
      // A candidate who did not attend cannot be scored or decided on.
      if (name === 'attendance' && value === 'not_attended') {
        Object.assign(next, EMPTY_SCORES, { decision: '' });
      }
      // Each reason belongs to its own decision.
      if (next.decision !== 'on_hold')
        Object.assign(next, { holdReason: '', nextFollowupDate: '' });
      if (next.decision !== 'not_selected') next.rejectReason = '';
      return next;
    });
    setErrors((old) => ({ ...old, [name]: undefined }));
  }

  async function save() {
    const problems = validate(values);
    setErrors(problems);
    setSaveError(null);
    if (Object.keys(problems).length > 0) return;

    setSaving(true);
    let res;
    try {
      const payload = toPayload(values);
      res = await (isNew
        ? createInterview({ candidateId: Number(candidateId), ...payload })
        : updateInterview(id, payload));
    } catch {
      res = null;
    }
    setSaving(false);

    if (res?.ok) {
      navigate(`/interviews/${res.body.interview.id}`, {
        state: { saved: `Interview saved. Current status: ${res.body.candidate.stage.name}.` },
      });
    } else if (res?.status === 422) {
      setErrors(res.body.fields ?? {});
      setSaveError('Some fields need correcting. Nothing was saved.');
    } else if (res?.status === 409) {
      setSaveError(
        'This candidate already has a direct interview. Open it from the Interview List to change it.',
      );
    } else if (res?.status === 403) {
      setSaveError('You do not have permission to record interviews.');
    } else {
      setSaveError('The interview could not be saved. Check your connection and try again.');
    }
  }

  const header = <PageHeader title={page.label} description={page.description} />;
  const inPanel = (content) => (
    <>
      {header}
      <section className="panel">{content}</section>
    </>
  );

  if (loaded.status === 'loading') return inPanel(<LoadingState />);
  if (isNew && !candidateId) {
    return inPanel(
      <EmptyState
        title="No candidate chosen"
        message="Open the Interview List and choose Evaluate next to a candidate."
      />,
    );
  }
  if (loaded.status === 'not-found') {
    return inPanel(
      <EmptyState
        title={isNew ? 'Candidate not found' : 'Interview not found'}
        message="There is nothing at this address."
      />,
    );
  }
  if (loaded.status !== 'ready') {
    return (
      <>
        {header}
        <ErrorState title="The interview could not be loaded" onRetry={loaded.reload} />
      </>
    );
  }

  const absent = values.attendance === 'not_attended';
  const total = calculateTotal(values);
  const field = (name) => ({
    name,
    value: values[name],
    onChange: (event) => set(name, event.target.value),
    disabled: saving,
    error: errors[name],
  });

  return (
    <>
      {header}
      <CandidateSummary candidate={loaded.data.candidate} />

      {saveError && (
        <Notice tone="danger" role="alert">
          {saveError}
        </Notice>
      )}
      {errors.candidateId && (
        <Notice tone="danger" role="alert">
          {errors.candidateId}
        </Notice>
      )}

      <FormPanel
        cancelTo={isNew ? '/interviews' : `/interviews/${id}`}
        onSubmit={save}
        saving={saving}
      >
        <div className="form-grid">
          <FormField
            label="Interview Date/Time"
            type="datetime-local"
            required
            hint="Office time (Asia/Colombo)."
            {...field('scheduledAt')}
          />
          <FormField
            label="Attendance"
            type="select"
            options={ATTENDANCE_OPTIONS}
            {...field('attendance')}
          />
          <FormField label="Interviewer" maxLength={150} {...field('interviewerName')} />
        </div>

        <fieldset className="form-section" disabled={absent}>
          <legend>
            Scores ({MIN_SCORE}–{MAX_SCORE} each)
          </legend>
          {absent && (
            <p className="panel__note">
              Scores cannot be entered for a candidate who did not attend.
            </p>
          )}
          <div className="form-grid form-grid--scores">
            {SCORE_CRITERIA.map((criterion) => (
              <FormField
                key={criterion.name}
                label={criterion.label}
                type="number"
                min={MIN_SCORE}
                max={MAX_SCORE}
                step={1}
                inputMode="numeric"
                {...field(criterion.name)}
              />
            ))}
          </div>
          {/* Shown, never typed: the database works out the stored total the same way. */}
          <p className="score-total">
            Total Score: <output aria-label="Total score">{total ?? '--'}</output> / {MAX_TOTAL}
            <span className="score-total__note">
              Calculated automatically once all five scores are between {MIN_SCORE} and {MAX_SCORE}.
            </span>
          </p>
        </fieldset>

        <div className="form-grid">
          <FormField
            label="Recommendation"
            type="select"
            name="recommendation"
            pending
            error={errors.recommendation}
          />
          <FormField
            label="Status"
            type="select"
            options={DECISION_OPTIONS}
            hint={
              absent
                ? 'Not available for a candidate who did not attend.'
                : 'Selected moves the candidate to Selected and creates their offer in the Offer Tracker automatically. Not Selected moves them to Rejected, and On Hold to On Hold.'
            }
            {...field('decision')}
            disabled={saving || absent}
          />
          {values.decision === 'on_hold' && (
            <>
              <FormField
                label="Reason for hold"
                type="textarea"
                wide
                required
                maxLength={500}
                {...field('holdReason')}
              />
              <FormField
                label="Next follow-up date"
                type="date"
                hint="Optional."
                {...field('nextFollowupDate')}
              />
            </>
          )}
          {values.decision === 'not_selected' && (
            <FormField
              label="Reason for rejection"
              type="textarea"
              wide
              required
              maxLength={500}
              {...field('rejectReason')}
            />
          )}
          <FormField label="Remarks" type="textarea" wide maxLength={2000} {...field('remarks')} />
        </div>
      </FormPanel>
    </>
  );
}

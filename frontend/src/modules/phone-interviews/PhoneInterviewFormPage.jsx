import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import FormField from '../../components/FormField.jsx';
import FormPanel from '../../components/FormPanel.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { fromOfficeInput, toOfficeInput } from '../../utils/format.js';
import { createPhoneInterview, getPhoneInterview, updatePhoneInterview } from './api.js';
import CandidateSummary from '../../components/CandidateSummary.jsx';
import { RESPONSE_OPTIONS, RESULT_OPTIONS, mailStatusHint, mailStatusLabel } from './fields.js';

const EMPTY_VALUES = {
  called: false,
  response: '',
  result: '',
  interviewAt: '',
  rejectReason: '',
  review: '',
};

function toFormValues({ phoneScreen, rejectReason }) {
  if (!phoneScreen) return EMPTY_VALUES;
  return {
    called: phoneScreen.called,
    response: phoneScreen.response ?? '',
    result: phoneScreen.result ?? '',
    interviewAt: toOfficeInput(phoneScreen.interviewAt),
    rejectReason: rejectReason ?? '',
    review: phoneScreen.review ?? '',
  };
}

// Quick checks for convenience. The backend checks everything again.
function validate(values) {
  const errors = {};
  if (values.result === 'not_selected' && !values.rejectReason.trim()) {
    errors.rejectReason = 'A reason for rejection is required when the result is Not Selected.';
  }
  return errors;
}

// Records or changes the phone interview of one candidate (the id in the
// address is the candidate's).
export default function PhoneInterviewFormPage({ page }) {
  const { id: candidateId } = useParams();
  const navigate = useNavigate();
  const loaded = useApi(() => getPhoneInterview(candidateId), [candidateId]);

  const [values, setValues] = useState(EMPTY_VALUES);
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (loaded.status === 'ready') setValues(toFormValues(loaded.data));
  }, [loaded.status, loaded.data]);

  function set(name, value) {
    setValues((old) => {
      const next = { ...old, [name]: value };
      // An interview date belongs only to a selected candidate, and a
      // rejection reason only to one who was not selected.
      if (name === 'result' && value !== 'selected') next.interviewAt = '';
      if (name === 'result' && value !== 'not_selected') next.rejectReason = '';
      return next;
    });
    setErrors((old) => ({ ...old, [name]: undefined }));
  }

  async function save() {
    const problems = validate(values);
    setErrors(problems);
    setSaveError(null);
    if (Object.keys(problems).length > 0) return;

    const payload = {
      called: values.called,
      response: values.response || null,
      result: values.result || null,
      interviewAt: fromOfficeInput(values.interviewAt),
      rejectReason: values.rejectReason,
      review: values.review,
    };
    const existing = loaded.data.phoneScreen;

    setSaving(true);
    let res;
    try {
      res = await (existing
        ? updatePhoneInterview(existing.id, payload)
        : createPhoneInterview({ candidateId: Number(candidateId), ...payload }));
    } catch {
      res = null;
    }
    setSaving(false);

    if (res?.ok) {
      navigate(`/phone-interviews/${candidateId}`, {
        state: {
          saved: `Phone interview saved. Current status: ${res.body.candidate.stage.name}.`,
        },
      });
    } else if (res?.status === 422) {
      setErrors(res.body.fields ?? {});
      setSaveError('Some fields need correcting. Nothing was saved.');
    } else if (res?.status === 409) {
      setSaveError(
        'Someone else has just recorded this phone interview. Reload the page to see it.',
      );
    } else if (res?.status === 403) {
      setSaveError('You do not have permission to record phone interviews.');
    } else {
      setSaveError('The phone interview could not be saved. Check your connection and try again.');
    }
  }

  const header = <PageHeader title={page.label} description={page.description} />;

  if (loaded.status === 'loading') {
    return (
      <>
        {header}
        <section className="panel">
          <LoadingState />
        </section>
      </>
    );
  }
  if (loaded.status === 'not-found') {
    return (
      <>
        {header}
        <section className="panel">
          <EmptyState
            title="Candidate not found"
            message="There is no candidate at this address."
          />
        </section>
      </>
    );
  }
  if (loaded.status !== 'ready') {
    return (
      <>
        {header}
        <ErrorState title="The phone interview could not be loaded" onRetry={loaded.reload} />
      </>
    );
  }

  const isSelected = values.result === 'selected';

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

      <FormPanel cancelTo={`/phone-interviews/${candidateId}`} onSubmit={save} saving={saving}>
        <div className="form-grid">
          <FormField
            label="Called"
            type="checkbox"
            name="called"
            checked={values.called}
            onChange={(event) => set('called', event.target.checked)}
            disabled={saving}
            error={errors.called}
          />
          <FormField
            label="Response"
            type="select"
            name="response"
            options={RESPONSE_OPTIONS}
            value={values.response}
            onChange={(event) => set('response', event.target.value)}
            disabled={saving}
            error={errors.response}
            hint="How the call went. It does not change the Result."
          />
          <FormField
            label="Result"
            type="select"
            name="result"
            options={RESULT_OPTIONS}
            value={values.result}
            onChange={(event) => set('result', event.target.value)}
            disabled={saving}
            error={errors.result}
            hint="Selected moves the candidate to Phone Screened, or to Interview Scheduled once an interview date is saved. Not Selected moves the candidate to Rejected."
          />
          <FormField
            label="Interview Date/Time"
            type="datetime-local"
            name="interviewAt"
            value={values.interviewAt}
            onChange={(event) => set('interviewAt', event.target.value)}
            disabled={saving || !isSelected}
            error={errors.interviewAt}
            hint={
              isSelected ? 'Office time (Asia/Colombo).' : 'Available when the result is Selected.'
            }
          />
          {values.result === 'not_selected' && (
            <FormField
              label="Reason for rejection"
              type="textarea"
              name="rejectReason"
              wide
              required
              maxLength={500}
              value={values.rejectReason}
              onChange={(event) => set('rejectReason', event.target.value)}
              disabled={saving}
              error={errors.rejectReason}
            />
          )}
          <FormField
            label="Review"
            type="textarea"
            name="review"
            wide
            maxLength={2000}
            value={values.review}
            onChange={(event) => set('review', event.target.value)}
            disabled={saving}
            error={errors.review}
            hint="Your remark about the call."
          />
          <FormField
            label="Mail Status"
            name="mailStatus"
            value={mailStatusLabel(loaded.data.candidate.mailStatus)}
            readOnly
            hint={mailStatusHint(loaded.data.candidate.mailStatus)}
          />
        </div>
      </FormPanel>
    </>
  );
}

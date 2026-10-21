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
import {
  MAIL_STATUS_OPTIONS,
  RESPONSE_OPTIONS,
  RESULT_OPTIONS,
  mailStatusDraftValue,
} from './fields.js';

// The Remark is HR's note about the call. It is stored in the phone interview's
// existing review column. For Not Selected the backend also keeps a reason for
// rejection with the candidate's pipeline status; the same text serves as both,
// so there is one field to fill in.
//
// "Remark" is a third choice in the Result dropdown that exists only on this
// form. The database has no such result, so choosing it records the remark and
// nothing else: no result is selected or cleared and the stage never changes.
const REMARK_CHOICE = 'remark';
const FORM_RESULT_OPTIONS = [...RESULT_OPTIONS, { value: REMARK_CHOICE, label: 'Remark' }];
const EMPTY_VALUES = {
  called: false,
  response: '',
  result: '',
  interviewAt: '',
  remark: '',
};

function toFormValues({ phoneScreen, rejectReason }) {
  if (!phoneScreen) return EMPTY_VALUES;
  return {
    called: phoneScreen.called,
    response: phoneScreen.response ?? '',
    // A call with a remark but no decision shows as the Remark choice.
    result: phoneScreen.result ?? (phoneScreen.review ? REMARK_CHOICE : ''),
    interviewAt: toOfficeInput(phoneScreen.interviewAt),
    // A candidate rejected before the Remark existed may have a reason but no review.
    remark:
      phoneScreen.review || (phoneScreen.result === 'not_selected' ? (rejectReason ?? '') : ''),
  };
}

// Quick checks for convenience. The backend checks everything again.
function validate(values) {
  const errors = {};
  if (values.result === 'not_selected' && !values.remark.trim()) {
    errors.remark = 'A remark is required when the result is Not Selected.';
  } else if (values.result === 'not_selected' && values.remark.trim().length > 500) {
    errors.remark = 'For Not Selected the remark must be at most 500 characters.';
  } else if (values.result === REMARK_CHOICE && !values.remark.trim()) {
    errors.remark = 'A remark is required when the result is Remark.';
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
  const [reviewDraft, setReviewDraft] = useState('');
  const [mailStatusDraft, setMailStatusDraft] = useState('not_sent');
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (loaded.status === 'ready') {
      setValues(toFormValues(loaded.data));
      setMailStatusDraft(mailStatusDraftValue(loaded.data.candidate.mailStatus));
    }
  }, [loaded.status, loaded.data]);

  function set(name, value) {
    setValues((old) => {
      const next = { ...old, [name]: value };
      // An interview date belongs only to a selected candidate.
      if (name === 'result' && value !== 'selected') next.interviewAt = '';
      return next;
    });
    setErrors((old) => ({ ...old, [name]: undefined }));
  }

  async function save() {
    const problems = validate(values);
    setErrors(problems);
    setSaveError(null);
    if (Object.keys(problems).length > 0) return;

    const existing = loaded.data.phoneScreen;
    const remark = values.remark.trim();
    // Not Selected: the remark is also the reason for rejection. An earlier,
    // different reason is kept as it is when the remark was not touched.
    const earlierRemark = toFormValues(loaded.data).remark.trim();
    const earlierReason = loaded.data.rejectReason ?? '';
    const rejectReason =
      values.result !== 'not_selected'
        ? ''
        : remark === earlierRemark && earlierReason
          ? earlierReason
          : remark;
    // The Remark choice records the remark only. The result, interview date and
    // rejection reason already on file (if any) are sent back exactly as they
    // are, so the backend sees no change of outcome and moves no stage.
    const remarkOnly = values.result === REMARK_CHOICE;
    const payload = {
      called: values.called,
      response: values.response || null,
      result: remarkOnly ? (existing?.result ?? null) : values.result || null,
      interviewAt: remarkOnly
        ? (existing?.interviewAt ?? null)
        : fromOfficeInput(values.interviewAt),
      rejectReason: remarkOnly ? earlierReason : rejectReason,
      review: remark,
    };

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
      const fields = res.body.fields ?? {};
      // The backend names the remark by where it is stored.
      setErrors({ ...fields, remark: fields.remark ?? fields.review ?? fields.rejectReason });
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
          <div className="form-grid form-grid--two field--wide">
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
              options={FORM_RESULT_OPTIONS}
              value={values.result}
              onChange={(event) => set('result', event.target.value)}
              disabled={saving}
              error={errors.result}
            />
          </div>
          <FormField
            label="Remark"
            type="textarea"
            name="remark"
            wide
            required={values.result === 'not_selected' || values.result === REMARK_CHOICE}
            maxLength={2000}
            value={values.remark}
            placeholder="Enter call remarks..."
            onChange={(event) => set('remark', event.target.value)}
            disabled={saving}
            error={errors.remark}
            hint="Your remark about the call. Required when the result is Not Selected (where it is also kept as the reason for rejection) or Remark; optional when Selected."
          />
          <FormField
            label="Review"
            type="textarea"
            name="reviewDraft"
            wide
            maxLength={2000}
            value={reviewDraft}
            placeholder="Enter HR review..."
            onChange={(event) => setReviewDraft(event.target.value)}
            disabled={saving}
            hint="Draft only; not saved. The phone interview schema has no separate Review field."
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
          <FormField
            label="Mail Status"
            type="select"
            name="mailStatus"
            hideEmptyOption
            options={MAIL_STATUS_OPTIONS}
            value={mailStatusDraft}
            onChange={(event) => setMailStatusDraft(event.target.value)}
            disabled={saving}
            hint="Draft only. Mail Status is read from email_log and cannot be saved here."
          />
        </div>
      </FormPanel>
    </>
  );
}

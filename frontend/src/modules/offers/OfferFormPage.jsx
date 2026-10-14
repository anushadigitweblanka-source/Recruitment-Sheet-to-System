import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { listLookup } from '../../api/lookups.js';
import CandidateSummary from '../../components/CandidateSummary.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import FormField from '../../components/FormField.jsx';
import FormPanel from '../../components/FormPanel.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { getCandidate } from '../candidates/api.js';
import { createOffer, getOffer, listOffers, updateOffer } from './api.js';
import { ATTENDED_OPTIONS, OFFER_STATUS_OPTIONS } from './fields.js';
import SalaryPendingNotice from './SalaryPendingNotice.jsx';

const EMPTY_VALUES = {
  positionId: '',
  offerDate: '',
  location: '',
  offerStatus: '',
  onboardingDate: '',
  attended: '',
};

// The stage a candidate must be at to receive an offer.
const STAGE_BEFORE_OFFER = 'selected';

const text = (value) => (value === null || value === undefined ? '' : String(value));

// Loads the record the form is about together with the approved positions.
// A new offer starts from the candidate; an existing one from the offer.
async function loadForm({ id, candidateId }) {
  const [record, positions] = await Promise.all([
    id ? getOffer(id) : getCandidate(candidateId),
    listLookup('positions'),
  ]);
  if (!record.ok) return record;
  if (!positions.ok) return positions;

  if (id) return { ...record, body: { ...record.body, positions: positions.body.items } };

  const { candidate } = record.body;
  return {
    ...record,
    body: {
      candidate: { ...candidate, position: candidate.position?.name ?? null },
      appliedPositionId: candidate.positionId,
      offer: null,
      positions: positions.body.items,
    },
  };
}

// What the form starts with: an existing offer, or for a new one the position
// the candidate applied for, when it is still in use.
function toFormValues(data) {
  if (!data.offer) {
    const applied = data.positions.find((p) => p.id === data.appliedPositionId && p.isActive);
    return { ...EMPTY_VALUES, positionId: applied ? String(applied.id) : '' };
  }
  const { offer } = data;
  return {
    positionId: text(offer.positionId),
    offerDate: text(offer.offerDate),
    location: text(offer.location),
    offerStatus: text(offer.offerStatus),
    onboardingDate: text(offer.onboardingDate),
    attended: offer.attended === true ? 'yes' : offer.attended === false ? 'no' : '',
  };
}

// Quick checks for convenience. The backend checks everything again.
function validate(values) {
  const errors = {};
  if (!values.positionId) errors.positionId = 'Position is required.';
  if (values.attended) {
    if (!values.onboardingDate) {
      errors.onboardingDate = 'Set the Onboarding Date before recording attendance.';
    }
    if (values.offerStatus !== 'accepted') {
      errors.attended = 'Attendance can be recorded once the Offer Status is Accepted.';
    }
  }
  return errors;
}

// Work Mode is never sent: its values have not been approved yet.
function toPayload(values) {
  return {
    positionId: Number(values.positionId),
    offerDate: values.offerDate || null,
    location: values.location,
    offerStatus: values.offerStatus || null,
    onboardingDate: values.onboardingDate || null,
    attended: values.attended === 'yes' ? true : values.attended === 'no' ? false : null,
  };
}

// Opened from the sidebar with no candidate: choose one of the selected
// candidates who do not have an offer yet.
function ChooseCandidate({ header }) {
  const [, setSearchParams] = useSearchParams();
  const waiting = useApi(() => listOffers({ waiting: true, pageSize: 100 }), []);

  let content;
  if (waiting.status === 'loading') {
    content = <LoadingState message="Loading candidates…" />;
  } else if (waiting.status === 'forbidden') {
    content = <ErrorState title="You do not have permission to view offers" />;
  } else if (waiting.status !== 'ready') {
    content = <ErrorState title="The candidates could not be loaded" onRetry={waiting.reload} />;
  } else if (waiting.data.items.length === 0) {
    content = (
      <EmptyState
        title="No candidate is waiting for an offer"
        message="A candidate can receive an offer once their direct interview result is Selected."
      />
    );
  } else {
    content = (
      <div className="form-grid">
        <FormField
          label="Candidate"
          type="select"
          name="candidate"
          value=""
          hint="Candidates whose direct interview result is Selected and who have no offer yet."
          onChange={(event) =>
            event.target.value && setSearchParams({ candidate: event.target.value })
          }
          options={waiting.data.items.map(({ candidate }) => ({
            value: String(candidate.id),
            label: `${candidate.candidateCode} — ${candidate.fullName}`,
          }))}
        />
      </div>
    );
  }

  return (
    <>
      {header}
      <SalaryPendingNotice />
      <section className="panel">{content}</section>
    </>
  );
}

// Creates or changes an offer.
//   /offers/new                 choose a candidate waiting for an offer
//   /offers/new?candidate=12    a new offer for candidate 12
//   /offers/7/edit              changes offer 7
export default function OfferFormPage({ page }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const candidateId = id ? null : searchParams.get('candidate');
  const header = <PageHeader title={page.label} description={page.description} />;

  if (!id && !candidateId) return <ChooseCandidate header={header} />;
  // The key gives each candidate or offer its own fresh form.
  return (
    <OfferForm key={id ?? `new-${candidateId}`} id={id} candidateId={candidateId} header={header} />
  );
}

function OfferForm({ id, candidateId, header }) {
  const navigate = useNavigate();
  const isNew = !id;
  const loaded = useApi(() => loadForm({ id, candidateId }), [id, candidateId]);

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
      // Attendance is about the joining day of an accepted offer.
      if (next.offerStatus !== 'accepted' || !next.onboardingDate) next.attended = '';
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
        ? createOffer({ candidateId: Number(candidateId), ...payload })
        : updateOffer(id, payload));
    } catch {
      res = null;
    }
    setSaving(false);

    if (res?.ok) {
      navigate(`/offers/${res.body.offer.id}`, {
        state: { saved: `Offer saved. Current status: ${res.body.candidate.stage.name}.` },
      });
    } else if (res?.status === 422) {
      setErrors(res.body.fields ?? {});
      setSaveError('Some fields need correcting. Nothing was saved.');
    } else if (res?.status === 409) {
      setSaveError(
        <>
          This candidate already has an offer.{' '}
          <Link to={`/offers/${res.body.offerId}`}>Open it</Link> to change it.
        </>,
      );
    } else if (res?.status === 403) {
      setSaveError('You do not have permission to manage offers.');
    } else {
      setSaveError('The offer could not be saved. Check your connection and try again.');
    }
  }

  const framed = (content) => (
    <>
      {header}
      <SalaryPendingNotice />
      {content}
    </>
  );
  const inPanel = (content) => framed(<section className="panel">{content}</section>);

  if (loaded.status === 'loading') return inPanel(<LoadingState />);
  if (loaded.status === 'not-found') {
    return inPanel(
      <EmptyState
        title={isNew ? 'Candidate not found' : 'Offer not found'}
        message="There is nothing at this address."
      />,
    );
  }
  if (loaded.status === 'forbidden') {
    return framed(<ErrorState title="You do not have permission to view offers" />);
  }
  if (loaded.status !== 'ready') {
    return framed(<ErrorState title="The offer could not be loaded" onRetry={loaded.reload} />);
  }

  const { candidate, offer, positions } = loaded.data;

  // The backend refuses this too; saying so here saves filling in the form.
  if (isNew && candidate.stage.code !== STAGE_BEFORE_OFFER) {
    return framed(
      <>
        <CandidateSummary candidate={candidate} />
        <Notice tone="warning" title="This candidate cannot receive an offer yet">
          An offer can be created once the candidate’s direct interview result is “Selected”. This
          candidate is at “{candidate.stage.name}”.
        </Notice>
        <p className="back-link">
          <Link to="/offers">Back to the offer list</Link>
        </p>
      </>,
    );
  }

  // Positions in use, plus the one already on the offer if it was switched off since.
  const positionOptions = positions
    .filter((p) => p.isActive || p.id === offer?.positionId)
    .map((p) => ({ value: String(p.id), label: p.name }));
  const canRecordAttendance = values.offerStatus === 'accepted' && Boolean(values.onboardingDate);
  const field = (name) => ({
    name,
    value: values[name],
    onChange: (event) => set(name, event.target.value),
    disabled: saving,
    error: errors[name],
  });

  return framed(
    <>
      <CandidateSummary candidate={candidate} />

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

      <FormPanel cancelTo={isNew ? '/offers' : `/offers/${id}`} onSubmit={save} saving={saving}>
        <div className="form-grid">
          <FormField
            label="Position Offered"
            type="select"
            required
            options={positionOptions}
            hint={
              positionOptions.length === 0
                ? 'No positions exist yet. Add them under Administration → Positions & Sources.'
                : undefined
            }
            {...field('positionId')}
          />
          <FormField label="Offer Date" type="date" {...field('offerDate')} />
          <FormField
            label="Work Mode"
            type="select"
            name="workMode"
            pending
            error={errors.workMode}
          />
          <FormField label="Location" maxLength={200} {...field('location')} />
          <FormField
            label="Offer Status"
            type="select"
            options={OFFER_STATUS_OPTIONS}
            hint="Leave empty until the offer has been sent. Sent moves the candidate to Offer Sent, and Accepted to Offer Accepted."
            {...field('offerStatus')}
          />
          <FormField
            label="Onboarding Date"
            type="date"
            hint="The joining date."
            {...field('onboardingDate')}
          />
          <FormField
            label="Attended"
            type="select"
            options={ATTENDED_OPTIONS}
            hint={
              canRecordAttendance
                ? 'Yes moves the candidate to Joined.'
                : 'Available once the Offer Status is Accepted and the Onboarding Date is set.'
            }
            {...field('attended')}
            disabled={saving || !canRecordAttendance}
          />
        </div>
      </FormPanel>
    </>,
  );
}

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { listLookup } from '../../api/lookups.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import CandidateSummary from '../../components/CandidateSummary.jsx';
import DataTable from '../../components/DataTable.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import FormField from '../../components/FormField.jsx';
import FormPanel from '../../components/FormPanel.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import SearchInput from '../../components/SearchInput.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { useApi } from '../../hooks/useApi.js';
import { getCandidate, listCandidates } from '../candidates/api.js';
import { createOffer, getOffer, listOffers, updateOffer } from './api.js';
import { ATTENDED_OPTIONS, OFFER_STATUS_OPTIONS, WORK_MODE_OPTIONS } from './fields.js';
import SalaryPendingNotice from './SalaryPendingNotice.jsx';

const EMPTY_VALUES = {
  positionId: '',
  offerDate: '',
  workMode: '',
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
    workMode: text(offer.workMode),
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

function toPayload(values) {
  return {
    positionId: Number(values.positionId),
    offerDate: values.offerDate || null,
    workMode: values.workMode || null,
    location: values.location,
    offerStatus: values.offerStatus || null,
    onboardingDate: values.onboardingDate || null,
    attended: values.attended === 'yes' ? true : values.attended === 'no' ? false : null,
  };
}

// What a candidate who cannot receive an offer yet still has to go through.
// The workflow is the approved one; this only says which step is next.
const NEXT_STEP = {
  applied:
    'Record their phone interview. A Selected result with a direct interview date moves them to Interview Scheduled.',
  phone_screened:
    'Give them a direct interview date in the phone interview. A Selected result with a date moves them to Interview Scheduled.',
  interview_scheduled:
    'Record their direct interview with the scores and the decision. When the decision is Selected, the offer is created automatically.',
  interviewed:
    'Record the decision of their direct interview. When the decision is Selected, the offer is created automatically.',
  on_hold:
    'Their direct interview result is On Hold. The offer is created automatically if that result is changed to Selected.',
  rejected:
    'Rejected candidates cannot receive an offer. An offer needs a direct interview result of Selected.',
  not_attended:
    'Record a direct interview they attended. When the decision is Selected, the offer is created automatically.',
  no_response:
    'Record a direct interview they attended. When the decision is Selected, the offer is created automatically.',
};
const DEFAULT_NEXT_STEP = 'An offer can be created once the direct interview result is Selected.';

const SEARCH_DELAY_MS = 300;

const candidateLabel = (candidate) => `${candidate.candidateCode} — ${candidate.fullName}`;

// Where HR picks the candidate: a searchable list of Selected candidates,
// each with the offer the direct interview created automatically. Both lists
// come from the database through the existing offer and candidate APIs.
function CandidateSelector({ selectedId, selectedLabel }) {
  const [, setSearchParams] = useSearchParams();
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [text]);

  const eligible = useApi(() => listOffers({ search, pageSize: 100 }), [search]);
  const others = useApi(
    () =>
      search
        ? listCandidates({ search, pageSize: 8 })
        : Promise.resolve({ ok: true, body: { items: [] } }),
    [search],
  );

  const choose = (id) => setSearchParams(id ? { candidate: String(id) } : {});

  if (eligible.status === 'forbidden') {
    return <ErrorState title="You do not have permission to view offers" />;
  }

  const entries = eligible.status === 'ready' ? eligible.data.items : [];
  const options = entries.map(({ candidate, offer }) => ({
    value: String(candidate.id),
    label: `${candidateLabel(candidate)}${offer ? '' : ' (no offer yet)'}`,
  }));
  // The chosen candidate stays in the list even when the search has moved on.
  if (selectedId && selectedLabel && !options.some((o) => o.value === String(selectedId))) {
    options.unshift({ value: String(selectedId), label: selectedLabel });
  }

  const eligibleIds = new Set(entries.map(({ candidate }) => String(candidate.id)));
  const notReady =
    others.status === 'ready'
      ? others.data.items.filter((candidate) => !eligibleIds.has(String(candidate.id)))
      : [];

  const nothingToPrepare = !search && eligible.status === 'ready' && entries.length === 0;

  return (
    <section className="panel" aria-labelledby="offer-picker-title">
      <h2 id="offer-picker-title" className="panel__title">
        Candidate
      </h2>
      <SearchInput
        label="Search"
        placeholder="Candidate ID or name"
        value={text}
        onChange={setText}
      />
      <FormField
        label="Selected Candidate"
        type="select"
        name="candidate"
        value={selectedId ? String(selectedId) : ''}
        options={options}
        onChange={(event) => choose(event.target.value)}
        disabled={eligible.status === 'loading' && entries.length === 0}
        hint="Candidates whose direct interview result is Selected. Their offer was created automatically."
      />
      {nothingToPrepare && (
        <EmptyState
          title="No selected candidate needs an offer prepared"
          message="An offer is created automatically when a direct interview result is Selected. Selected candidates will appear here, and every existing offer is in the Offer List."
        />
      )}
      {nothingToPrepare && (
        <p>
          <Link to="/offers">Go to the Offer List</Link>
        </p>
      )}
      {notReady.length > 0 && (
        <DataTable
          caption="Other candidates found"
          columns={[
            { key: 'candidate', label: 'Not ready for an offer' },
            { key: 'stage', label: 'Current Status' },
            { key: 'action', label: 'Action' },
          ]}
          rows={notReady.map((candidate) => ({
            id: candidate.id,
            candidate: candidateLabel(candidate),
            stage: <StatusBadge tone="info">{candidate.stage.name}</StatusBadge>,
            action: (
              <button
                type="button"
                className="button-link"
                aria-label={`Why ${candidate.fullName} cannot receive an offer`}
                onClick={() => choose(candidate.id)}
              >
                Why not?
              </button>
            ),
          }))}
        />
      )}
    </section>
  );
}

// The chosen candidate's offer: loaded and editable when it exists (the one
// the direct interview created), a one-off creation when the safe exception
// applies, otherwise where they stand and what must happen first. The backend
// enforces every rule again when the offer is saved.
function SelectedCandidate({ selected, notice, version, onSaved }) {
  if (selected.status === 'loading') {
    return (
      <section className="panel">
        <LoadingState />
      </section>
    );
  }
  if (selected.status === 'not-found') {
    return (
      <section className="panel">
        <EmptyState title="Candidate not found" message="There is nothing at this address." />
      </section>
    );
  }
  if (selected.status === 'forbidden') {
    return <ErrorState title="You do not have permission to view offers" />;
  }
  if (selected.status !== 'ready') {
    return <ErrorState title="The candidate could not be loaded" onRetry={selected.reload} />;
  }

  const { candidate, offer } = selected.data;
  const banner = notice && (
    <Notice tone="success" role="status">
      {notice}
    </Notice>
  );

  if (offer) {
    return (
      <>
        {banner}
        <CandidateSummary candidate={candidate} />
        <p className="back-link">
          <Link to={`/offers/${offer.id}`}>View the offer details</Link>
        </p>
        <OfferForm
          key={`offer-${offer.id}-${version}`}
          id={String(offer.id)}
          candidateId={null}
          header={null}
          showSalaryNotice={false}
          inline
          onSaved={onSaved}
        />
      </>
    );
  }

  if (candidate.stage.code === STAGE_BEFORE_OFFER) {
    return (
      <>
        {banner}
        <CandidateSummary candidate={candidate} />
        <Notice tone="info" title="No offer exists for this candidate yet">
          An offer is normally created automatically when the direct interview result is Selected.
          This candidate has none, usually because no applied position was recorded. It can be
          created here, once, by choosing the position offered.
        </Notice>
        <OfferForm
          key={`new-${candidate.id}-${version}`}
          id={null}
          candidateId={String(candidate.id)}
          header={null}
          showSalaryNotice={false}
          inline
          onSaved={onSaved}
        />
      </>
    );
  }

  return (
    <>
      <CandidateSummary candidate={candidate} />
      <Notice tone="warning" title="This candidate cannot receive an offer yet">
        Current status: <strong>{candidate.stage.name}</strong>.{' '}
        {NEXT_STEP[candidate.stage.code] ?? DEFAULT_NEXT_STEP}
      </Notice>
      <p className="back-link">
        <Link to={`/candidates/${candidate.id}`}>Open the candidate</Link>
      </p>
    </>
  );
}

// Prepares and completes offers.
//   /offers/new                 choose a Selected candidate
//   /offers/new?candidate=12    candidate 12: their automatic offer to complete,
//                               the one-off creation, or what must happen first
//   /offers/7/edit              changes offer 7 (unchanged)
export default function OfferFormPage({ page }) {
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const candidateId = id ? null : searchParams.get('candidate');
  const header = <PageHeader title={page.label} description={page.description} />;

  if (id) return <OfferForm key={id} id={id} candidateId={null} header={header} />;
  return <PrepareOffer header={header} candidateId={candidateId} />;
}

function PrepareOffer({ header, candidateId }) {
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState(null);

  // The chosen candidate with their offer, found by Candidate ID in the same
  // list the page shows. Reloaded after every save so the details stay current.
  const selected = useApi(async () => {
    if (!candidateId) return { ok: true, status: 200, body: null };
    const candidate = await getCandidate(candidateId);
    if (!candidate.ok) return candidate;
    const record = candidate.body.candidate;
    const offers = await listOffers({ search: record.candidateCode, pageSize: 100 });
    if (!offers.ok) return offers;
    const entry = offers.body.items.find((e) => String(e.candidate.id) === String(candidateId));
    return {
      ok: true,
      status: 200,
      body: {
        candidate: { ...record, position: record.position?.name ?? record.position ?? null },
        offer: entry?.offer ?? null,
      },
    };
  }, [candidateId, version]);

  const selectedLabel =
    selected.status === 'ready' && selected.data ? candidateLabel(selected.data.candidate) : null;

  return (
    <>
      {header}
      <SalaryPendingNotice />
      <CandidateSelector key="selector" selectedId={candidateId} selectedLabel={selectedLabel} />
      {candidateId && (
        <SelectedCandidate
          key={candidateId}
          selected={
            selected.status === 'ready' && selected.data === null
              ? { status: 'loading' }
              : { ...selected, data: selected.data }
          }
          notice={notice}
          version={version}
          onSaved={(message) => {
            setNotice(message);
            setVersion((n) => n + 1);
          }}
        />
      )}
    </>
  );
}

function OfferForm({ id, candidateId, header, showSalaryNotice = true, inline = false, onSaved }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isNew = !id;
  // On Prepare Offer, people who may not manage offers see the offer but get no
  // Save button. The server refuses them as well.
  const readOnly = inline && !user?.permissions?.includes('offers.manage');
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
      const saved = `Offer saved. Current status: ${res.body.candidate.stage.name}.`;
      // On the Prepare Offer page the same offer is shown again, refreshed.
      if (inline) onSaved?.(saved);
      else navigate(`/offers/${res.body.offer.id}`, { state: { saved } });
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
      {showSalaryNotice && <SalaryPendingNotice />}
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
  // Once the employee record exists the joining is settled; the server refuses
  // changes to these three fields, so the form says so instead.
  const locked = inline && offer?.attended === true;
  const canRecordAttendance = values.offerStatus === 'accepted' && Boolean(values.onboardingDate);
  const field = (name) => ({
    name,
    value: values[name],
    onChange: (event) => set(name, event.target.value),
    disabled: saving || readOnly,
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

      {locked && (
        <Notice tone="warning" title="This offer is finalized">
          The candidate has joined and an employee record exists, so the offer status, onboarding
          date and attendance can no longer be changed. The other fields can still be updated.
        </Notice>
      )}

      {readOnly && (
        <Notice tone="info" title="You can view this offer, not change it">
          Only users who may manage offers can save changes here.
        </Notice>
      )}

      {readOnly ? (
        <section className="panel">
          <div className="form-grid">
            <FormField
              label="Position Offered"
              type="select"
              required
              options={positionOptions}
              hint={
                positionOptions.length === 0 ? (
                  <>
                    No positions exist yet. Add them under{' '}
                    <Link to="/admin/lookups">Administration → Positions &amp; Sources</Link>.
                  </>
                ) : undefined
              }
              {...field('positionId')}
            />
            <FormField label="Offer Date" type="date" {...field('offerDate')} />
            <FormField
              label="Work Mode"
              type="select"
              options={WORK_MODE_OPTIONS}
              hint="Office is a temporary value that requires mentor confirmation."
              {...field('workMode')}
            />
            <FormField label="Location" maxLength={200} {...field('location')} />
            <FormField
              label="Offer Status"
              type="select"
              options={OFFER_STATUS_OPTIONS}
              hint="Leave empty until the offer has been sent. Sent moves the candidate to Offer Sent, and Accepted to Offer Accepted."
              {...field('offerStatus')}
              disabled={saving || readOnly || locked}
            />
            <FormField
              label="Onboarding Date"
              type="date"
              hint="The joining date."
              {...field('onboardingDate')}
              disabled={saving || readOnly || locked}
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
              disabled={saving || readOnly || locked || !canRecordAttendance}
            />
          </div>
        </section>
      ) : (
        <FormPanel
          cancelTo={isNew || inline ? '/offers' : `/offers/${id}`}
          onSubmit={save}
          saving={saving}
          saveLabel={inline ? 'Save Offer' : 'Save'}
        >
          <div className="form-grid">
            <FormField
              label="Position Offered"
              type="select"
              required
              options={positionOptions}
              hint={
                positionOptions.length === 0 ? (
                  <>
                    No positions exist yet. Add them under{' '}
                    <Link to="/admin/lookups">Administration → Positions &amp; Sources</Link>.
                  </>
                ) : undefined
              }
              {...field('positionId')}
            />
            <FormField label="Offer Date" type="date" {...field('offerDate')} />
            <FormField
              label="Work Mode"
              type="select"
              options={WORK_MODE_OPTIONS}
              hint="Office is a temporary value that requires mentor confirmation."
              {...field('workMode')}
            />
            <FormField label="Location" maxLength={200} {...field('location')} />
            <FormField
              label="Offer Status"
              type="select"
              options={OFFER_STATUS_OPTIONS}
              hint="Leave empty until the offer has been sent. Sent moves the candidate to Offer Sent, and Accepted to Offer Accepted."
              {...field('offerStatus')}
              disabled={saving || readOnly || locked}
            />
            <FormField
              label="Onboarding Date"
              type="date"
              hint="The joining date."
              {...field('onboardingDate')}
              disabled={saving || readOnly || locked}
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
              disabled={saving || readOnly || locked || !canRecordAttendance}
            />
          </div>
        </FormPanel>
      )}
    </>,
  );
}

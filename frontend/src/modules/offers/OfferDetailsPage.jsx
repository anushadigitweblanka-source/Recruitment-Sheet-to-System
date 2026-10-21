import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthContext.jsx';
import CandidateSummary from '../../components/CandidateSummary.jsx';
import DetailList from '../../components/DetailList.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatDate, formatDateTime } from '../../utils/format.js';
import { getOffer, updateOffer } from './api.js';
import {
  emailStatusLabel,
  OFFER_STATUS_LABELS,
  OFFER_STATUS_TONES,
  SUPPORTED_WORK_MODE_VALUES,
  WORK_MODE_OPTIONS,
  attendedLabel,
} from './fields.js';
import SalaryPanel from './SalaryPanel.jsx';

const FIELDS = [
  { name: 'position', label: 'Position Offered' },
  { name: 'offerDate', label: 'Offer Date' },
  { name: 'location', label: 'Location' },
  { name: 'offerStatus', label: 'Offer Status' },
  { name: 'emailStatus', label: 'Email Status' },
  { name: 'onboardingDate', label: 'Onboarding Date' },
  { name: 'attended', label: 'Attended' },
  { name: 'updated', label: 'Last Updated' },
];

function toDisplayValues({ candidate, offer }) {
  return {
    position: offer.position,
    offerDate: formatDate(offer.offerDate),
    location: offer.location,
    offerStatus: offer.offerStatus ? (
      <StatusBadge tone={OFFER_STATUS_TONES[offer.offerStatus]}>
        {OFFER_STATUS_LABELS[offer.offerStatus]}
      </StatusBadge>
    ) : (
      <StatusBadge>Not sent</StatusBadge>
    ),
    emailStatus: emailStatusLabel(candidate.mailStatus),
    onboardingDate: formatDate(offer.onboardingDate),
    attended: attendedLabel(offer.attended),
    updated: `${formatDateTime(offer.updatedAt)}${offer.updatedBy ? ` by ${offer.updatedBy}` : ''}`,
  };
}

export default function OfferDetailsPage({ page }) {
  const { id } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const loaded = useApi(() => getOffer(id), [id]);
  const data = loaded.status === 'ready' ? loaded.data : null;
  const canManage = user?.permissions?.includes('offers.manage') ?? false;
  const [workMode, setWorkMode] = useState('');
  const [workModeSaving, setWorkModeSaving] = useState(false);
  const [workModeMessage, setWorkModeMessage] = useState(null);

  useEffect(() => {
    if (data) setWorkMode(data.offer.workMode ?? '');
  }, [data]);

  async function saveWorkMode() {
    setWorkModeSaving(true);
    setWorkModeMessage(null);
    const result = await updateOffer(id, { workMode: workMode || null }).catch(() => null);
    setWorkModeSaving(false);
    if (result?.ok) {
      setWorkModeMessage({ tone: 'success', text: 'Work Mode saved.' });
      loaded.reload();
    } else if (result?.status === 422) {
      setWorkModeMessage({
        tone: 'danger',
        text: result.body.fields?.workMode ?? 'The selected Work Mode is not supported.',
      });
    } else if (result?.status === 403) {
      setWorkModeMessage({ tone: 'danger', text: 'You do not have permission to manage offers.' });
    } else {
      setWorkModeMessage({ tone: 'danger', text: 'Work Mode could not be saved. Try again.' });
    }
  }

  return (
    <>
      <PageHeader
        title={page.label}
        description={page.description}
        actions={
          data && (
            <Link to={`/offers/${id}/edit`} className="button button--primary">
              Edit offer
            </Link>
          )
        }
      />

      {location.state?.saved && (
        <Notice tone="success" role="status">
          {location.state.saved}
        </Notice>
      )}
      {workModeMessage && (
        <Notice
          tone={workModeMessage.tone}
          role={workModeMessage.tone === 'danger' ? 'alert' : 'status'}
        >
          {workModeMessage.text}
        </Notice>
      )}

      {loaded.status === 'error' && (
        <ErrorState title="The offer could not be loaded" onRetry={loaded.reload} />
      )}
      {loaded.status === 'forbidden' && (
        <ErrorState title="You do not have permission to view offers" />
      )}
      {loaded.status === 'loading' && (
        <section className="panel">
          <LoadingState message="Loading offer…" />
        </section>
      )}
      {loaded.status === 'not-found' && (
        <section className="panel">
          <EmptyState title="Offer not found" message="There is no offer at this address." />
        </section>
      )}

      {data && (
        <>
          <CandidateSummary candidate={data.candidate} />
          <section className="panel">
            <DetailList fields={FIELDS} values={toDisplayValues(data)} />
          </section>
        </>
      )}

      {data && (
        <section className="panel">
          <dl className="detail-list">
            <div className="detail-list__item">
              <dt>Work Mode</dt>
              <dd>
                <select
                  aria-label="Work Mode"
                  className="field__control"
                  value={workMode}
                  onChange={(event) => {
                    setWorkMode(event.target.value);
                    setWorkModeMessage(null);
                  }}
                  disabled={!canManage || workModeSaving}
                >
                  <option value="">Select...</option>
                  {WORK_MODE_OPTIONS.map((option) => (
                    <option key={option.value || 'empty'} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                {canManage && (
                  <div className="form-actions">
                    <button
                      className="button button--primary"
                      type="button"
                      onClick={saveWorkMode}
                      disabled={
                        workModeSaving ||
                        workMode === (data.offer.workMode ?? '') ||
                        !SUPPORTED_WORK_MODE_VALUES.has(workMode)
                      }
                    >
                      {workModeSaving ? 'Saving…' : 'Save Work Mode'}
                    </button>
                  </div>
                )}
                {canManage && !SUPPORTED_WORK_MODE_VALUES.has(workMode) && (
                  <p className="field__hint">
                    Online and Work from Home cannot be saved yet. The approved backend and database
                    constraint currently support Office only.
                  </p>
                )}
                {!canManage && (
                  <p className="field__hint">You do not have permission to change Work Mode.</p>
                )}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {data && <SalaryPanel candidateId={data.candidate.id} />}

      <p className="back-link">
        <Link to="/offers">Back to the offer list</Link>
      </p>
    </>
  );
}

import { Link, useLocation, useParams } from 'react-router';
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
import { getOffer } from './api.js';
import {
  EMAIL_STATUS_UNAVAILABLE,
  OFFER_STATUS_LABELS,
  OFFER_STATUS_TONES,
  attendedLabel,
  workModeLabel,
} from './fields.js';
import SalaryPendingNotice from './SalaryPendingNotice.jsx';

const FIELDS = [
  { name: 'position', label: 'Position Offered' },
  { name: 'offerDate', label: 'Offer Date' },
  { name: 'workMode', label: 'Work Mode' },
  { name: 'location', label: 'Location' },
  { name: 'offerStatus', label: 'Offer Status' },
  { name: 'emailStatus', label: 'Email Status' },
  { name: 'onboardingDate', label: 'Onboarding Date' },
  { name: 'attended', label: 'Attended' },
  { name: 'updated', label: 'Last Updated' },
];

function toDisplayValues({ offer }) {
  return {
    position: offer.position,
    offerDate: formatDate(offer.offerDate),
    workMode: workModeLabel(offer.workMode),
    location: offer.location,
    offerStatus: offer.offerStatus ? (
      <StatusBadge tone={OFFER_STATUS_TONES[offer.offerStatus]}>
        {OFFER_STATUS_LABELS[offer.offerStatus]}
      </StatusBadge>
    ) : (
      <StatusBadge>Not sent</StatusBadge>
    ),
    emailStatus: EMAIL_STATUS_UNAVAILABLE,
    onboardingDate: formatDate(offer.onboardingDate),
    attended: attendedLabel(offer.attended),
    updated: `${formatDateTime(offer.updatedAt)}${offer.updatedBy ? ` by ${offer.updatedBy}` : ''}`,
  };
}

export default function OfferDetailsPage({ page }) {
  const { id } = useParams();
  const location = useLocation();
  const loaded = useApi(() => getOffer(id), [id]);
  const data = loaded.status === 'ready' ? loaded.data : null;

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

      <SalaryPendingNotice />

      <p className="back-link">
        <Link to="/offers">Back to the offer list</Link>
      </p>
    </>
  );
}

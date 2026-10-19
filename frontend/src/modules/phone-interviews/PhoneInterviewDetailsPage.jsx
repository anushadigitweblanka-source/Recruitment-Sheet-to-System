import { Link, useLocation, useParams } from 'react-router';
import DetailList from '../../components/DetailList.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatDateTime } from '../../utils/format.js';
import { getPhoneInterview } from './api.js';
import CandidateSummary from '../../components/CandidateSummary.jsx';
import { RESULT_LABELS, RESULT_TONES, mailStatusLabel } from './fields.js';

const FIELDS = [
  { name: 'called', label: 'Called' },
  { name: 'response', label: 'Response' },
  { name: 'result', label: 'Result' },
  { name: 'interviewAt', label: 'Interview Date/Time' },
  { name: 'rejectReason', label: 'Reason for rejection' },
  { name: 'review', label: 'Review' },
  { name: 'mailStatus', label: 'Mail Status' },
  { name: 'updated', label: 'Last Updated' },
];

function toDisplayValues({ candidate, phoneScreen, rejectReason }) {
  return {
    called: phoneScreen.called ? 'Yes' : 'No',
    response: phoneScreen.response,
    result: phoneScreen.result ? (
      <StatusBadge tone={RESULT_TONES[phoneScreen.result]}>
        {RESULT_LABELS[phoneScreen.result]}
      </StatusBadge>
    ) : (
      <StatusBadge>Not recorded</StatusBadge>
    ),
    interviewAt: formatDateTime(phoneScreen.interviewAt),
    rejectReason,
    review: phoneScreen.review,
    mailStatus: mailStatusLabel(candidate.mailStatus),
    updated: `${formatDateTime(phoneScreen.updatedAt)}${phoneScreen.updatedBy ? ` by ${phoneScreen.updatedBy}` : ''}`,
  };
}

// The phone interview of one candidate (the id in the address is the candidate's).
export default function PhoneInterviewDetailsPage({ page }) {
  const { id: candidateId } = useParams();
  const location = useLocation();
  const loaded = useApi(() => getPhoneInterview(candidateId), [candidateId]);
  const data = loaded.status === 'ready' ? loaded.data : null;

  return (
    <>
      <PageHeader
        title={page.label}
        description={page.description}
        actions={
          data && (
            <Link to={`/phone-interviews/${candidateId}/edit`} className="button button--primary">
              {data.phoneScreen ? 'Edit phone interview' : 'Record phone interview'}
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
        <ErrorState title="The phone interview could not be loaded" onRetry={loaded.reload} />
      )}
      {loaded.status === 'forbidden' && (
        <ErrorState title="You do not have permission to view phone interviews" />
      )}
      {loaded.status === 'loading' && (
        <section className="panel">
          <LoadingState message="Loading phone interview…" />
        </section>
      )}
      {loaded.status === 'not-found' && (
        <section className="panel">
          <EmptyState
            title="Candidate not found"
            message="There is no candidate at this address."
          />
        </section>
      )}

      {data && (
        <>
          <CandidateSummary candidate={data.candidate} />
          <section className="panel">
            {data.phoneScreen ? (
              <DetailList fields={FIELDS} values={toDisplayValues(data)} />
            ) : (
              <EmptyState
                title="No phone interview has been recorded yet"
                message="Use Record phone interview once the candidate has been called."
              />
            )}
          </section>
        </>
      )}

      <p className="back-link">
        <Link to="/phone-interviews">Back to the phone interview list</Link>
      </p>
    </>
  );
}

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
import { getInterview } from './api.js';
import { ATTENDANCE_LABELS, DECISION_LABELS, DECISION_TONES, formatTotal } from './fields.js';
import { MAX_TOTAL, SCORE_CRITERIA } from './scoring.js';

const FIELDS = [
  { name: 'scheduledAt', label: 'Interview Date/Time' },
  { name: 'attendance', label: 'Attendance' },
  { name: 'interviewerName', label: 'Interviewer' },
  ...SCORE_CRITERIA,
  { name: 'total', label: `Total / ${MAX_TOTAL}` },
  { name: 'recommendation', label: 'Recommendation' },
  { name: 'status', label: 'Status' },
  { name: 'holdReason', label: 'Reason for hold' },
  { name: 'nextFollowupDate', label: 'Next follow-up date' },
  { name: 'rejectReason', label: 'Reason for rejection' },
  { name: 'remarks', label: 'Remarks' },
  { name: 'companyCv', label: 'Company CV' },
  { name: 'updated', label: 'Last Updated' },
];

const CV_STATUS = { not_sent: 'Not sent', sent: 'Sent', received: 'Received', overdue: 'Overdue' };

// The Company CV link when it has arrived, else its status; CV pending is
// shown to HR and the Team Lead alike.
function companyCvCell(candidate) {
  if (!candidate) return null;
  const status = CV_STATUS[candidate.companyCvStatus] ?? candidate.companyCvStatus;
  if (candidate.companyCvUrl) {
    return (
      <>
        <a href={candidate.companyCvUrl} target="_blank" rel="noopener noreferrer">
          Open Company CV
        </a>{' '}
        ({status})
      </>
    );
  }
  return candidate.companyCvPending ? (
    <StatusBadge tone="warning">CV pending ({status})</StatusBadge>
  ) : (
    status
  );
}

function toDisplayValues({ candidate, interview, holdReason, nextFollowupDate, rejectReason }) {
  return {
    companyCv: companyCvCell(candidate),
    scheduledAt: formatDateTime(interview.scheduledAt),
    attendance: ATTENDANCE_LABELS[interview.attendance],
    interviewerName: interview.interviewerName,
    ...Object.fromEntries(SCORE_CRITERIA.map((c) => [c.name, interview[c.name]])),
    total: formatTotal(interview.totalScore),
    recommendation: interview.recommendation,
    status: interview.decision ? (
      <StatusBadge tone={DECISION_TONES[interview.decision]}>
        {DECISION_LABELS[interview.decision]}
      </StatusBadge>
    ) : (
      <StatusBadge>Not decided</StatusBadge>
    ),
    holdReason,
    nextFollowupDate: formatDate(nextFollowupDate),
    rejectReason,
    remarks: interview.remarks,
    updated: `${formatDateTime(interview.updatedAt)}${interview.updatedBy ? ` by ${interview.updatedBy}` : ''}`,
  };
}

export default function InterviewDetailsPage({ page }) {
  const { id } = useParams();
  const location = useLocation();
  const loaded = useApi(() => getInterview(id), [id]);
  const data = loaded.status === 'ready' ? loaded.data : null;

  // Reasons only apply to their own decision, so the other rows are left out.
  const fields = data
    ? FIELDS.filter(
        (field) =>
          !['holdReason', 'nextFollowupDate', 'rejectReason'].includes(field.name) ||
          (field.name === 'rejectReason'
            ? data.interview.decision === 'not_selected'
            : data.interview.decision === 'on_hold'),
      )
    : [];

  return (
    <>
      <PageHeader
        title={page.label}
        description={page.description}
        actions={
          data && (
            <Link to={`/interviews/${id}/evaluate`} className="button button--primary">
              Evaluate interview
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
        <ErrorState title="The interview could not be loaded" onRetry={loaded.reload} />
      )}
      {loaded.status === 'forbidden' && (
        <ErrorState title="You do not have permission to view interviews" />
      )}
      {loaded.status === 'loading' && (
        <section className="panel">
          <LoadingState message="Loading interview…" />
        </section>
      )}
      {loaded.status === 'not-found' && (
        <section className="panel">
          <EmptyState
            title="Interview not found"
            message="There is no interview at this address."
          />
        </section>
      )}

      {data && (
        <>
          <CandidateSummary candidate={data.candidate} />
          <section className="panel">
            <DetailList fields={fields} values={toDisplayValues(data)} />
          </section>
        </>
      )}

      <p className="back-link">
        <Link to="/interviews">Back to the interview list</Link>
      </p>
    </>
  );
}

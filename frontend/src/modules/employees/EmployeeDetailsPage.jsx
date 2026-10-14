import { useState } from 'react';
import { Link, useLocation, useParams } from 'react-router';
import DetailList from '../../components/DetailList.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatDate } from '../../utils/format.js';
import { getEmployee } from './api.js';
import DecisionForm, { TerminationForm } from './DecisionForm.jsx';
import { PhaseHistoryTable, nextReviewText, outcomeBadge, phaseEndText } from './display.jsx';
import { PHASE_LABELS, TRACK_LABELS } from './fields.js';
import LifecycleMentorNotice from './LifecycleMentorNotice.jsx';

const IDENTITY_FIELDS = [
  { name: 'candidateCode', label: 'Candidate ID' },
  { name: 'fullName', label: 'Employee' },
  { name: 'phone', label: 'Phone' },
  { name: 'position', label: 'Position' },
];

const EMPLOYMENT_FIELDS = [
  { name: 'joinDate', label: 'Join Date' },
  { name: 'track', label: 'Track' },
  { name: 'currentPhase', label: 'Current Phase' },
  { name: 'phaseStart', label: 'Phase Start' },
  { name: 'phaseEnd', label: 'Phase End' },
  { name: 'outcome', label: 'Outcome' },
  { name: 'nextReview', label: 'Next Review' },
];

const EXIT_FIELDS = [
  { name: 'exitDate', label: 'Exit Date' },
  { name: 'exitReason', label: 'Exit Reason' },
  { name: 'exitApprovedBy', label: 'Recorded By' },
];

export default function EmployeeDetailsPage({ page }) {
  const { id } = useParams();
  const location = useLocation();
  const loaded = useApi(() => getEmployee(id), [id]);
  const [saved, setSaved] = useState(location.state?.saved ?? null);
  const data = loaded.status === 'ready' ? loaded.data : null;

  // After a decision the page shows the result of the reloaded record.
  const onSaved = (message) => {
    setSaved(message);
    loaded.reload();
  };

  return (
    <>
      <PageHeader
        title={page.label}
        description={page.description}
        actions={
          data && (
            <>
              <Link to={`/employees/${id}/lifecycle`} className="button button--primary">
                Lifecycle Timeline
              </Link>
              <Link to={`/employees/${id}/edit`} className="button">
                Edit track
              </Link>
            </>
          )
        }
      />

      {saved && (
        <Notice tone="success" role="status">
          {saved}
        </Notice>
      )}

      {loaded.status === 'error' && (
        <ErrorState title="The employee could not be loaded" onRetry={loaded.reload} />
      )}
      {loaded.status === 'forbidden' && (
        <ErrorState title="You do not have permission to view employees" />
      )}
      {loaded.status === 'loading' && !data && (
        <section className="panel">
          <LoadingState message="Loading employee…" />
        </section>
      )}
      {loaded.status === 'not-found' && (
        <section className="panel">
          <EmptyState title="Employee not found" message="There is no employee at this address." />
        </section>
      )}

      {data && (
        <>
          <section className="panel" aria-label="Employee">
            <DetailList
              fields={IDENTITY_FIELDS}
              values={{
                candidateCode: (
                  <Link to={`/candidates/${data.candidate.id}`}>
                    {data.candidate.candidateCode}
                  </Link>
                ),
                fullName: data.candidate.fullName,
                phone: data.candidate.phone,
                position: data.employee.position,
              }}
            />
          </section>

          <section className="panel" aria-label="Employment">
            <DetailList
              fields={
                data.employee.status === 'active'
                  ? EMPLOYMENT_FIELDS
                  : [...EMPLOYMENT_FIELDS, ...EXIT_FIELDS]
              }
              values={{
                joinDate: formatDate(data.employee.joinDate),
                track: TRACK_LABELS[data.employee.track] ?? 'Not set',
                currentPhase: PHASE_LABELS[data.employee.currentPhase],
                phaseStart: formatDate(data.employee.phaseStart),
                phaseEnd: phaseEndText(data.employee),
                outcome: outcomeBadge(data.employee.status),
                nextReview: nextReviewText(data.employee),
                exitDate: formatDate(data.employee.exitDate),
                exitReason: data.employee.exitReason,
                exitApprovedBy: data.employee.exitApprovedBy,
              }}
            />
          </section>

          {data.employee.currentPhase === 'junior' && <LifecycleMentorNotice />}

          {data.decision && (
            <DecisionForm
              key={data.decision.phaseId}
              employeeId={id}
              decision={data.decision}
              onSaved={onSaved}
            />
          )}
          {data.canTerminate && <TerminationForm employeeId={id} onSaved={onSaved} />}

          <section className="panel" aria-labelledby="history-title">
            <h2 id="history-title" className="panel__title">
              Phase history
            </h2>
            <PhaseHistoryTable phases={data.phases} />
          </section>
        </>
      )}

      <p className="back-link">
        <Link to="/employees">Back to the employee list</Link>
      </p>
    </>
  );
}

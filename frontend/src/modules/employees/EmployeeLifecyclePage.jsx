import { Link, useParams } from 'react-router';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatDate } from '../../utils/format.js';
import { getEmployee } from './api.js';
import { PhaseHistoryTable, outcomeBadge } from './display.jsx';
import LifecycleMentorNotice from './LifecycleMentorNotice.jsx';
import LifecycleTimeline from './LifecycleTimeline.jsx';

export default function EmployeeLifecyclePage({ page }) {
  const { id } = useParams();
  const loaded = useApi(() => getEmployee(id), [id]);
  const data = loaded.status === 'ready' ? loaded.data : null;

  return (
    <>
      <PageHeader
        title={page.label}
        description={page.description}
        actions={
          <Link to={`/employees/${id}`} className="button">
            Back to employee
          </Link>
        }
      />

      <LifecycleMentorNotice />

      <section className="panel" aria-labelledby="timeline-title">
        <h2 id="timeline-title" className="panel__title">
          Timeline{data ? ` — ${data.candidate.fullName}` : ''}
        </h2>
        <LifecycleTimeline employee={data?.employee} phases={data?.phases} />
        {data && (
          <p className="panel__note">
            Joined {formatDate(data.employee.joinDate)}. Outcome:{' '}
            {outcomeBadge(data.employee.status)}
          </p>
        )}
        {loaded.status === 'loading' && <LoadingState message="Loading lifecycle…" />}
      </section>

      {loaded.status === 'error' && (
        <ErrorState title="The lifecycle could not be loaded" onRetry={loaded.reload} />
      )}
      {loaded.status === 'forbidden' && (
        <ErrorState title="You do not have permission to view employees" />
      )}
      {loaded.status === 'not-found' && (
        <section className="panel">
          <EmptyState title="Employee not found" message="There is no employee at this address." />
        </section>
      )}

      {data && (
        <section className="panel" aria-labelledby="history-title">
          <h2 id="history-title" className="panel__title">
            Phase history
          </h2>
          <PhaseHistoryTable phases={data.phases} />
        </section>
      )}
    </>
  );
}

import { Link, useParams } from 'react-router';
import DataTable from '../../components/DataTable.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { PHASE_HISTORY_COLUMNS } from './fields.js';
import LifecycleMentorNotice from './LifecycleMentorNotice.jsx';
import LifecycleTimeline from './LifecycleTimeline.jsx';

export default function EmployeeLifecyclePage({ page }) {
  const { id } = useParams();

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
          Timeline
        </h2>
        <LifecycleTimeline />
        <p className="panel__note">
          No employee is loaded, so no phase is marked as current and no dates are shown.
        </p>
      </section>

      <section className="panel" aria-labelledby="history-title">
        <h2 id="history-title" className="panel__title">
          Phase history
        </h2>
        <DataTable
          caption="Phase history"
          columns={PHASE_HISTORY_COLUMNS}
          emptyTitle="Feature not connected yet"
          emptyMessage="Each phase and its gate decision will be listed here once the feature is built."
        />
      </section>
    </>
  );
}

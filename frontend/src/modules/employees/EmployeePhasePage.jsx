import DataTable from '../../components/DataTable.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { EMPLOYEE_COLUMNS } from './fields.js';
import LifecycleMentorNotice from './LifecycleMentorNotice.jsx';
import LifecycleTimeline from './LifecycleTimeline.jsx';

// One page per phase (and one for exits). `page.phase` names the timeline step
// to highlight; the exit page has none.
export default function EmployeePhasePage({ page }) {
  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      {page.phase && (
        <>
          <LifecycleMentorNotice />
          <section className="panel" aria-label="Lifecycle phases">
            <LifecycleTimeline current={page.phase} />
          </section>
        </>
      )}

      <section className="panel">
        <DataTable
          caption={page.label}
          columns={EMPLOYEE_COLUMNS}
          emptyTitle="Feature not connected yet"
          emptyMessage="Employees will be listed here once the feature is built."
        />
      </section>
    </>
  );
}

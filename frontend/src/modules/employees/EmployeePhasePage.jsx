import PageHeader from '../../components/PageHeader.jsx';
import EmployeeTable from './EmployeeTable.jsx';
import LifecycleMentorNotice from './LifecycleMentorNotice.jsx';
import LifecycleTimeline from './LifecycleTimeline.jsx';

// One page per phase (and one for exits). `page.phase` names the timeline step
// to highlight; `page.filter` is what the list always shows. Each employee is
// in exactly one of these pages: active employees by their current phase,
// everyone who has left on the exit page.
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

      <EmployeeTable
        caption={page.label}
        fixed={page.filter}
        filters={page.phase ? ['track'] : ['track', 'phase', 'status']}
        emptyTitle={page.phase ? `No one is in ${page.phase.toLowerCase()} now` : 'No one has left'}
        emptyMessage={
          page.phase
            ? 'Active employees in this phase are listed here.'
            : 'Discontinued and terminated employees are listed here.'
        }
      />
    </>
  );
}

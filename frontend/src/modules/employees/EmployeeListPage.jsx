import PageHeader from '../../components/PageHeader.jsx';
import EmployeeTable from './EmployeeTable.jsx';
import LifecycleTimeline from './LifecycleTimeline.jsx';

export default function EmployeeListPage({ page }) {
  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      <section className="panel" aria-labelledby="lifecycle-overview">
        <h2 id="lifecycle-overview" className="panel__title">
          Lifecycle phases
        </h2>
        <LifecycleTimeline />
      </section>

      <EmployeeTable
        caption="Employees"
        emptyTitle="No employees yet"
        emptyMessage="An employee is added automatically when their offer is marked Attended = Yes."
      />
    </>
  );
}

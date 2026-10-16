import { useAuth } from '../../auth/AuthContext.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import JoiningVerificationPanel from '../historical/JoiningVerificationPanel.jsx';
import EmployeeTable from './EmployeeTable.jsx';
import LifecycleTimeline from './LifecycleTimeline.jsx';

export default function EmployeeListPage({ page }) {
  const { user } = useAuth();
  const canViewHistorical = (user?.permissions ?? []).includes('historical.view');

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

      {/* Imported interview records marked Selected. Read only, and not employees
          until a person verifies the joining through the offer workflow. */}
      {canViewHistorical && <JoiningVerificationPanel />}
    </>
  );
}

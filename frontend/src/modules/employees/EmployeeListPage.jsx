import DataTable from '../../components/DataTable.jsx';
import FilterBar, { FilterSelect } from '../../components/FilterBar.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import SearchInput from '../../components/SearchInput.jsx';
import { EMPLOYEE_COLUMNS } from './fields.js';
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

      <section className="panel">
        <FilterBar label="Employee filters">
          <SearchInput label="Search" placeholder="Employee or candidate ID" disabled />
          <FilterSelect label="Track" disabled />
          <FilterSelect label="Current Phase" disabled />
        </FilterBar>

        <DataTable
          caption="Employees"
          columns={EMPLOYEE_COLUMNS}
          emptyTitle="Feature not connected yet"
          emptyMessage="Employees will be listed here once the feature is built."
        />
      </section>
    </>
  );
}

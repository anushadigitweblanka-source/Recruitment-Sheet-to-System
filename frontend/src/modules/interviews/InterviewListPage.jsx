import DataTable from '../../components/DataTable.jsx';
import FilterBar, { FilterSelect } from '../../components/FilterBar.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import SearchInput from '../../components/SearchInput.jsx';
import { INTERVIEW_COLUMNS } from './fields.js';

export default function InterviewListPage({ page }) {
  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      <section className="panel">
        <FilterBar label="Interview filters">
          <SearchInput label="Search" placeholder="Candidate or interviewer" disabled />
          <FilterSelect label="Status" disabled />
        </FilterBar>

        <DataTable
          caption="Direct interviews"
          columns={INTERVIEW_COLUMNS}
          emptyTitle="Feature not connected yet"
          emptyMessage="Interviews will be listed here once the feature is built."
        />
      </section>
    </>
  );
}

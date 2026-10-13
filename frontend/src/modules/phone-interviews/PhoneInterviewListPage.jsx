import DataTable from '../../components/DataTable.jsx';
import FilterBar, { FilterSelect } from '../../components/FilterBar.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import SearchInput from '../../components/SearchInput.jsx';
import { PHONE_INTERVIEW_COLUMNS } from './fields.js';

export default function PhoneInterviewListPage({ page }) {
  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      <section className="panel">
        <FilterBar label="Phone interview filters">
          <SearchInput label="Search" placeholder="Name, phone or candidate ID" disabled />
          <FilterSelect label="Result" disabled />
        </FilterBar>

        <DataTable
          caption="Phone interviews"
          columns={PHONE_INTERVIEW_COLUMNS}
          emptyTitle="Feature not connected yet"
          emptyMessage="Phone interviews will be listed here once the feature is built."
        />
      </section>
    </>
  );
}

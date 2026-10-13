import { Link } from 'react-router';
import DataTable from '../../components/DataTable.jsx';
import FilterBar, { FilterSelect } from '../../components/FilterBar.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import SearchInput from '../../components/SearchInput.jsx';
import { CANDIDATE_COLUMNS } from './fields.js';

// Layout only: the search and filters are disabled and the table is empty
// until the candidates feature and its database tables exist.
export default function CandidateListPage({ page }) {
  return (
    <>
      <PageHeader
        title={page.label}
        description={page.description}
        actions={
          <Link to="/candidates/new" className="button button--primary">
            Add Candidate
          </Link>
        }
      />

      <section className="panel">
        <FilterBar label="Candidate filters">
          <SearchInput label="Search" placeholder="Name, phone or candidate ID" disabled />
          <FilterSelect label="Position" disabled />
          <FilterSelect label="Source" disabled />
          <FilterSelect label="Status" disabled />
        </FilterBar>

        <DataTable
          caption="Candidates"
          columns={CANDIDATE_COLUMNS}
          emptyTitle="Feature not connected yet"
          emptyMessage="Candidates will be listed here once the feature is built."
        />
      </section>
    </>
  );
}

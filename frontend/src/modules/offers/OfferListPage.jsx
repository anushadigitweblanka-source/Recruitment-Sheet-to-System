import { Link } from 'react-router';
import DataTable from '../../components/DataTable.jsx';
import FilterBar, { FilterSelect } from '../../components/FilterBar.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import SearchInput from '../../components/SearchInput.jsx';
import { OFFER_COLUMNS } from './fields.js';

export default function OfferListPage({ page }) {
  return (
    <>
      <PageHeader
        title={page.label}
        description={page.description}
        actions={
          <Link to="/offers/new" className="button button--primary">
            Create Offer
          </Link>
        }
      />

      <section className="panel">
        <FilterBar label="Offer filters">
          <SearchInput label="Search" placeholder="Candidate or position" disabled />
          <FilterSelect label="Offer Status" disabled />
        </FilterBar>

        <DataTable
          caption="Offers"
          columns={OFFER_COLUMNS}
          emptyTitle="Feature not connected yet"
          emptyMessage="Offers will be listed here once the feature is built."
        />
      </section>
    </>
  );
}

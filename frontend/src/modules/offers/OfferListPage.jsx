import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import DataTable from '../../components/DataTable.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import FilterBar, { FilterSelect } from '../../components/FilterBar.jsx';
import FormField from '../../components/FormField.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Pagination from '../../components/Pagination.jsx';
import SearchInput from '../../components/SearchInput.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatDate } from '../../utils/format.js';
import { listOffers } from './api.js';
import {
  EMAIL_STATUS_UNAVAILABLE,
  OFFER_COLUMNS,
  OFFER_STATUS_LABELS,
  OFFER_STATUS_OPTIONS,
  OFFER_STATUS_TONES,
  attendedLabel,
} from './fields.js';

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

const STATUS_FILTER_OPTIONS = [
  ...OFFER_STATUS_OPTIONS,
  { value: 'pending', label: 'No status yet' },
];

// One row per candidate. A selected candidate waiting for their offer has no
// offer record yet: the row shows the position they applied for and offers
// "Create offer".
function toRow({ candidate, offer }) {
  const name = `${candidate.candidateCode} — ${candidate.fullName}`;

  return {
    id: candidate.id,
    candidate: offer ? <Link to={`/offers/${offer.id}`}>{name}</Link> : name,
    position: (offer ? offer.position : candidate.position) ?? '--',
    offerDate: formatDate(offer?.offerDate) ?? '--',
    workMode: offer?.workMode ?? '--',
    location: offer?.location ?? '--',
    offerStatus: offer?.offerStatus ? (
      <StatusBadge tone={OFFER_STATUS_TONES[offer.offerStatus]}>
        {OFFER_STATUS_LABELS[offer.offerStatus]}
      </StatusBadge>
    ) : (
      <StatusBadge>{offer ? 'Not sent' : 'No offer yet'}</StatusBadge>
    ),
    emailStatus: EMAIL_STATUS_UNAVAILABLE,
    onboardingDate: formatDate(offer?.onboardingDate) ?? '--',
    attended: attendedLabel(offer?.attended) ?? '--',
    actions: (
      <span className="table-actions">
        {offer ? (
          <>
            <Link to={`/offers/${offer.id}`} aria-label={`View offer of ${candidate.fullName}`}>
              View
            </Link>
            <Link
              to={`/offers/${offer.id}/edit`}
              aria-label={`Edit offer of ${candidate.fullName}`}
            >
              Edit
            </Link>
          </>
        ) : (
          <Link
            to={`/offers/new?candidate=${candidate.id}`}
            aria-label={`Create offer for ${candidate.fullName}`}
          >
            Create offer
          </Link>
        )}
      </span>
    ),
  };
}

export default function OfferListPage({ page }) {
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState({
    search: '',
    offerStatus: '',
    onboardingFrom: '',
    onboardingTo: '',
    page: 1,
  });

  // Changing a filter always goes back to the first page.
  const setFilter = (name, value) => setFilters((old) => ({ ...old, [name]: value, page: 1 }));

  // The search runs shortly after typing stops, not on every key press.
  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((old) =>
        old.search === searchText.trim() ? old : { ...old, search: searchText.trim(), page: 1 },
      );
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const list = useApi(
    () => listOffers({ ...filters, pageSize: PAGE_SIZE }),
    [
      filters.search,
      filters.offerStatus,
      filters.onboardingFrom,
      filters.onboardingTo,
      filters.page,
    ],
  );
  const isFiltered = Boolean(
    filters.search || filters.offerStatus || filters.onboardingFrom || filters.onboardingTo,
  );

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
          <SearchInput
            label="Search"
            placeholder="Candidate name or ID"
            value={searchText}
            onChange={setSearchText}
          />
          <FilterSelect
            label="Offer Status"
            value={filters.offerStatus}
            onChange={(value) => setFilter('offerStatus', value)}
            options={STATUS_FILTER_OPTIONS}
          />
          <FormField
            label="Onboarding from"
            type="date"
            value={filters.onboardingFrom}
            onChange={(event) => setFilter('onboardingFrom', event.target.value)}
          />
          <FormField
            label="Onboarding to"
            type="date"
            value={filters.onboardingTo}
            onChange={(event) => setFilter('onboardingTo', event.target.value)}
          />
        </FilterBar>

        {list.status === 'loading' && <LoadingState message="Loading offers…" />}

        {list.status === 'forbidden' && (
          <ErrorState
            title="You do not have permission to view offers"
            message="Ask an administrator if you need access."
          />
        )}

        {list.status === 'error' && (
          <ErrorState
            title="The offers could not be loaded"
            message="Check your connection and try again."
            onRetry={list.reload}
          />
        )}

        {list.status === 'ready' && (
          <>
            <DataTable
              caption="Offers"
              columns={OFFER_COLUMNS}
              rows={list.data.items.map(toRow)}
              emptyTitle={isFiltered ? 'No offers match' : 'No offers yet'}
              emptyMessage={
                isFiltered
                  ? 'Try a different search or clear the filters.'
                  : 'A candidate appears here once their direct interview result is Selected.'
              }
            />
            <Pagination
              page={list.data.page}
              pageSize={list.data.pageSize}
              total={list.data.total}
              onPageChange={(next) => setFilters((old) => ({ ...old, page: next }))}
            />
          </>
        )}
      </section>
    </>
  );
}

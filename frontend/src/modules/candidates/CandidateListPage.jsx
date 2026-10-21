import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthContext.jsx';
import RecruitmentRecordsList from '../historical/RecruitmentRecordsList.jsx';
import { loadCandidateLookups } from '../../api/lookups.js';
import DataTable from '../../components/DataTable.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import FilterBar, { FilterSelect } from '../../components/FilterBar.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Pagination from '../../components/Pagination.jsx';
import SearchInput from '../../components/SearchInput.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatDate } from '../../utils/format.js';
import { listCandidates } from './api.js';
import { CANDIDATE_COLUMNS } from './fields.js';

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

const toOptions = (items) => items.map((item) => ({ value: String(item.id), label: item.name }));

function toRow(candidate, canEdit) {
  return {
    id: candidate.id,
    candidateCode: <Link to={`/candidates/${candidate.id}`}>{candidate.candidateCode}</Link>,
    fullName: candidate.fullName,
    phone: candidate.phone ?? '--',
    email: candidate.email ?? '--',
    position: candidate.position?.name ?? '--',
    source: candidate.source?.name ?? '--',
    stage: <StatusBadge tone="info">{candidate.stage.name}</StatusBadge>,
    createdAt: formatDate(candidate.createdAt),
    actions: (
      <span className="table-actions">
        <Link
          to={`/candidates/${candidate.id}`}
          aria-label={`View details of ${candidate.fullName}`}
        >
          View Details
        </Link>
        {canEdit && (
          <Link to={`/candidates/${candidate.id}/edit`} aria-label={`Edit ${candidate.fullName}`}>
            Edit
          </Link>
        )}
      </span>
    ),
  };
}

// The live candidate list: what everyone without access to the imported history sees.
function CurrentCandidatesList({ page }) {
  const { user } = useAuth();
  const canEdit = (user?.permissions ?? []).includes('candidates.edit');
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState({
    search: '',
    positionId: '',
    sourceId: '',
    stage: '',
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

  const lookups = useApi(loadCandidateLookups, []);
  const list = useApi(
    () => listCandidates({ ...filters, pageSize: PAGE_SIZE }),
    [filters.search, filters.positionId, filters.sourceId, filters.stage, filters.page],
    { refreshOnFocus: true },
  );

  const lookupsReady = lookups.status === 'ready';
  const positions = lookupsReady ? toOptions(lookups.data.positions) : [];
  const sources = lookupsReady ? toOptions(lookups.data.sources) : [];
  const stages = lookupsReady
    ? lookups.data.stages.map((stage) => ({ value: stage.code, label: stage.name }))
    : [];
  const isFiltered = Boolean(
    filters.search || filters.positionId || filters.sourceId || filters.stage,
  );

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
          <SearchInput
            label="Search"
            placeholder="Name, phone, email or candidate ID"
            value={searchText}
            onChange={setSearchText}
          />
          <FilterSelect
            label="Position"
            value={filters.positionId}
            onChange={(value) => setFilter('positionId', value)}
            options={positions}
            disabled={!lookupsReady}
          />
          <FilterSelect
            label="Source"
            value={filters.sourceId}
            onChange={(value) => setFilter('sourceId', value)}
            options={sources}
            disabled={!lookupsReady}
          />
          <FilterSelect
            label="Status"
            value={filters.stage}
            onChange={(value) => setFilter('stage', value)}
            options={stages}
            disabled={!lookupsReady}
          />
        </FilterBar>

        {lookups.status === 'error' && (
          <p className="panel__note">The filter lists could not be loaded. Search still works.</p>
        )}
        {lookupsReady && positions.length === 0 && sources.length === 0 && (
          <p className="panel__note">
            No positions or sources have been defined yet. An administrator can add them under
            Administration → Positions &amp; Sources.
          </p>
        )}

        {list.status === 'loading' && <LoadingState message="Loading candidates…" />}

        {list.status === 'forbidden' && (
          <ErrorState
            title="You do not have permission to view candidates"
            message="Ask an administrator if you need access."
          />
        )}

        {list.status === 'error' && (
          <ErrorState
            title="The candidates could not be loaded"
            message="Check your connection and try again."
            onRetry={list.reload}
          />
        )}

        {list.status === 'ready' && (
          <>
            <DataTable
              caption="Candidates"
              columns={CANDIDATE_COLUMNS}
              rows={list.data.items.map((candidate) => toRow(candidate, canEdit))}
              emptyTitle={isFiltered ? 'No candidates match' : 'No candidates yet'}
              emptyMessage={
                isFiltered
                  ? 'Try a different search or clear the filters.'
                  : 'Use Add Candidate to register the first one.'
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

// Main User and HR get one Recruitment Records list that holds the imported
// history and the live candidates together; everyone else keeps the live list.
export default function CandidateListPage({ page }) {
  const { user } = useAuth();
  if (!(user?.permissions ?? []).includes('historical.view')) {
    return <CurrentCandidatesList page={page} />;
  }
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
      <RecruitmentRecordsList />
    </>
  );
}

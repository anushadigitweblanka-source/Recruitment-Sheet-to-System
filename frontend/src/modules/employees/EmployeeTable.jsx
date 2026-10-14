import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import DataTable from '../../components/DataTable.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import FilterBar, { FilterSelect } from '../../components/FilterBar.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import Pagination from '../../components/Pagination.jsx';
import SearchInput from '../../components/SearchInput.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatDate } from '../../utils/format.js';
import { listEmployees } from './api.js';
import { nextReviewText, outcomeBadge, phaseEndText } from './display.jsx';
import {
  EMPLOYEE_COLUMNS,
  PHASE_LABELS,
  PHASE_OPTIONS,
  STATUS_OPTIONS,
  TRACK_LABELS,
  TRACK_OPTIONS,
} from './fields.js';

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

const TRACK_FILTER_OPTIONS = [...TRACK_OPTIONS, { value: 'none', label: 'Not set' }];

function toRow(item) {
  const { candidate } = item;
  return {
    id: item.id,
    employee: <Link to={`/employees/${item.id}`}>{candidate.fullName}</Link>,
    candidateCode: candidate.candidateCode,
    joinDate: formatDate(item.joinDate),
    track: TRACK_LABELS[item.track] ?? 'Not set',
    currentPhase: PHASE_LABELS[item.currentPhase],
    phaseStart: formatDate(item.phaseStart),
    phaseEnd: phaseEndText(item) ?? '--',
    outcome: outcomeBadge(item.status),
    nextReview: nextReviewText(item) ?? '--',
    actions: (
      <span className="table-actions">
        <Link to={`/employees/${item.id}`} aria-label={`View ${candidate.fullName}`}>
          View
        </Link>
        <Link
          to={`/employees/${item.id}/lifecycle`}
          aria-label={`Lifecycle of ${candidate.fullName}`}
        >
          Lifecycle
        </Link>
      </span>
    ),
  };
}

// The employee table with its search and filters.
//   fixed:   filters the page always applies (a phase page shows one phase)
//   filters: which filter controls to offer
export default function EmployeeTable({
  caption,
  fixed = {},
  filters: offered = ['track', 'phase', 'status'],
  emptyTitle,
  emptyMessage,
}) {
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState({ search: '', track: '', phase: '', status: '', page: 1 });

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

  const query = { ...filters, ...fixed, pageSize: PAGE_SIZE };
  const list = useApi(() => listEmployees(query), [JSON.stringify(query)]);
  const isFiltered = Boolean(filters.search || filters.track || filters.phase || filters.status);

  return (
    <section className="panel">
      <FilterBar label="Employee filters">
        <SearchInput
          label="Search"
          placeholder="Employee name or candidate ID"
          value={searchText}
          onChange={setSearchText}
        />
        {offered.includes('track') && (
          <FilterSelect
            label="Track"
            value={filters.track}
            onChange={(value) => setFilter('track', value)}
            options={TRACK_FILTER_OPTIONS}
          />
        )}
        {offered.includes('phase') && (
          <FilterSelect
            label="Current Phase"
            value={filters.phase}
            onChange={(value) => setFilter('phase', value)}
            options={PHASE_OPTIONS}
          />
        )}
        {offered.includes('status') && (
          <FilterSelect
            label="Outcome"
            value={filters.status}
            onChange={(value) => setFilter('status', value)}
            options={STATUS_OPTIONS}
          />
        )}
      </FilterBar>

      {list.status === 'loading' && <LoadingState message="Loading employees…" />}
      {list.status === 'forbidden' && (
        <ErrorState
          title="You do not have permission to view employees"
          message="Ask an administrator if you need access."
        />
      )}
      {list.status === 'error' && (
        <ErrorState
          title="The employees could not be loaded"
          message="Check your connection and try again."
          onRetry={list.reload}
        />
      )}
      {list.status === 'ready' && (
        <>
          <DataTable
            caption={caption}
            columns={EMPLOYEE_COLUMNS}
            rows={list.data.items.map(toRow)}
            emptyTitle={isFiltered ? 'No employees match' : emptyTitle}
            emptyMessage={
              isFiltered ? 'Try a different search or clear the filters.' : emptyMessage
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
  );
}

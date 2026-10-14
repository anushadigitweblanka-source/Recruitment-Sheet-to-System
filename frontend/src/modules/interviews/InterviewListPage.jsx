import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import DataTable from '../../components/DataTable.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import FilterBar, { FilterSelect } from '../../components/FilterBar.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Pagination from '../../components/Pagination.jsx';
import SearchInput from '../../components/SearchInput.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatDateTime } from '../../utils/format.js';
import { listInterviews } from './api.js';
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_OPTIONS,
  DECISION_LABELS,
  DECISION_OPTIONS,
  DECISION_TONES,
  INTERVIEW_COLUMNS,
  formatTotal,
} from './fields.js';

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

const ATTENDANCE_FILTER_OPTIONS = [
  ...ATTENDANCE_OPTIONS,
  { value: 'pending', label: 'Not recorded yet' },
];
const DECISION_FILTER_OPTIONS = [
  ...DECISION_OPTIONS,
  { value: 'pending', label: 'Not decided yet' },
];

// One row per candidate. A candidate waiting for their interview has no
// interview record yet: the row shows the slot agreed on the phone and
// offers "Evaluate".
function toRow({ candidate, interview, plannedAt }) {
  const name = `${candidate.candidateCode} — ${candidate.fullName}`;
  const evaluateAt = interview
    ? `/interviews/${interview.id}/evaluate`
    : `/interviews/new?candidate=${candidate.id}`;

  return {
    id: candidate.id,
    candidate: interview ? <Link to={`/interviews/${interview.id}`}>{name}</Link> : name,
    scheduledAt: formatDateTime(interview?.scheduledAt ?? plannedAt) ?? '--',
    attendance: ATTENDANCE_LABELS[interview?.attendance] ?? '--',
    interviewer: interview?.interviewerName ?? '--',
    total: formatTotal(interview?.totalScore) ?? '--',
    recommendation: interview?.recommendation ?? '--',
    status: interview?.decision ? (
      <StatusBadge tone={DECISION_TONES[interview.decision]}>
        {DECISION_LABELS[interview.decision]}
      </StatusBadge>
    ) : (
      <StatusBadge>Not decided</StatusBadge>
    ),
    actions: (
      <span className="table-actions">
        {interview && (
          <Link
            to={`/interviews/${interview.id}`}
            aria-label={`View interview of ${candidate.fullName}`}
          >
            View
          </Link>
        )}
        <Link to={evaluateAt} aria-label={`Evaluate interview of ${candidate.fullName}`}>
          Evaluate
        </Link>
      </span>
    ),
  };
}

export default function InterviewListPage({ page }) {
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState({ search: '', attendance: '', decision: '', page: 1 });

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
    () => listInterviews({ ...filters, pageSize: PAGE_SIZE }),
    [filters.search, filters.attendance, filters.decision, filters.page],
  );
  const isFiltered = Boolean(filters.search || filters.attendance || filters.decision);

  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      <section className="panel">
        <FilterBar label="Interview filters">
          <SearchInput
            label="Search"
            placeholder="Candidate name or ID"
            value={searchText}
            onChange={setSearchText}
          />
          <FilterSelect
            label="Attendance"
            value={filters.attendance}
            onChange={(value) => setFilter('attendance', value)}
            options={ATTENDANCE_FILTER_OPTIONS}
          />
          <FilterSelect
            label="Status"
            value={filters.decision}
            onChange={(value) => setFilter('decision', value)}
            options={DECISION_FILTER_OPTIONS}
          />
        </FilterBar>

        {list.status === 'loading' && <LoadingState message="Loading interviews…" />}

        {list.status === 'forbidden' && (
          <ErrorState
            title="You do not have permission to view interviews"
            message="Ask an administrator if you need access."
          />
        )}

        {list.status === 'error' && (
          <ErrorState
            title="The interviews could not be loaded"
            message="Check your connection and try again."
            onRetry={list.reload}
          />
        )}

        {list.status === 'ready' && (
          <>
            <DataTable
              caption="Direct interviews"
              columns={INTERVIEW_COLUMNS}
              rows={list.data.items.map(toRow)}
              emptyTitle={isFiltered ? 'No interviews match' : 'No interviews yet'}
              emptyMessage={
                isFiltered
                  ? 'Try a different search or clear the filters.'
                  : 'A candidate appears here once their phone interview result is Selected and an interview date has been saved.'
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

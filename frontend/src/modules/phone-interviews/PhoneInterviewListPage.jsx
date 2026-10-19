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
import { listPhoneInterviews } from './api.js';
import {
  mailStatusLabel,
  PHONE_INTERVIEW_COLUMNS,
  RESULT_LABELS,
  RESULT_OPTIONS,
  RESULT_TONES,
} from './fields.js';

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;
const REVIEW_PREVIEW_LENGTH = 60;

const RESULT_FILTER_OPTIONS = [...RESULT_OPTIONS, { value: 'pending', label: 'Not recorded yet' }];
const CALLED_FILTER_OPTIONS = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
];

const shorten = (text) =>
  text.length > REVIEW_PREVIEW_LENGTH ? `${text.slice(0, REVIEW_PREVIEW_LENGTH)}…` : text;

// One row per candidate. A candidate who has not been phoned yet has no
// phone interview, so those cells show "--".
function toRow({ candidate, phoneScreen }) {
  const address = `/phone-interviews/${candidate.id}`;
  return {
    id: candidate.id,
    candidateCode: <Link to={address}>{candidate.candidateCode}</Link>,
    candidateName: candidate.fullName,
    phone: candidate.phone ?? '--',
    called: phoneScreen ? (phoneScreen.called ? 'Yes' : 'No') : '--',
    response: phoneScreen?.response ?? '--',
    result: phoneScreen?.result ? (
      <StatusBadge tone={RESULT_TONES[phoneScreen.result]}>
        {RESULT_LABELS[phoneScreen.result]}
      </StatusBadge>
    ) : (
      <StatusBadge>Not recorded</StatusBadge>
    ),
    review: phoneScreen?.review ? shorten(phoneScreen.review) : '--',
    interviewAt: formatDateTime(phoneScreen?.interviewAt) ?? '--',
    mailStatus: mailStatusLabel(candidate.mailStatus),
    actions: (
      <span className="table-actions">
        <Link to={address} aria-label={`View phone interview of ${candidate.fullName}`}>
          View
        </Link>
        <Link
          to={`${address}/edit`}
          aria-label={`${phoneScreen ? 'Edit' : 'Record'} phone interview of ${candidate.fullName}`}
        >
          {phoneScreen ? 'Edit' : 'Record'}
        </Link>
      </span>
    ),
  };
}

export default function PhoneInterviewListPage({ page }) {
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState({ search: '', result: '', called: '', page: 1 });

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
    () => listPhoneInterviews({ ...filters, pageSize: PAGE_SIZE }),
    [filters.search, filters.result, filters.called, filters.page],
  );
  const isFiltered = Boolean(filters.search || filters.result || filters.called);

  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      <section className="panel">
        <FilterBar label="Phone interview filters">
          <SearchInput
            label="Search"
            placeholder="Name, phone or candidate ID"
            value={searchText}
            onChange={setSearchText}
          />
          <FilterSelect
            label="Result"
            value={filters.result}
            onChange={(value) => setFilter('result', value)}
            options={RESULT_FILTER_OPTIONS}
          />
          <FilterSelect
            label="Called"
            value={filters.called}
            onChange={(value) => setFilter('called', value)}
            options={CALLED_FILTER_OPTIONS}
          />
        </FilterBar>

        {list.status === 'loading' && <LoadingState message="Loading phone interviews…" />}

        {list.status === 'forbidden' && (
          <ErrorState
            title="You do not have permission to view phone interviews"
            message="Ask an administrator if you need access."
          />
        )}

        {list.status === 'error' && (
          <ErrorState
            title="The phone interviews could not be loaded"
            message="Check your connection and try again."
            onRetry={list.reload}
          />
        )}

        {list.status === 'ready' && (
          <>
            <DataTable
              caption="Phone interviews"
              columns={PHONE_INTERVIEW_COLUMNS}
              rows={list.data.items.map(toRow)}
              emptyTitle={isFiltered ? 'No candidates match' : 'No candidates yet'}
              emptyMessage={
                isFiltered
                  ? 'Try a different search or clear the filters.'
                  : 'Candidates appear here as soon as they are added in Candidate Management.'
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

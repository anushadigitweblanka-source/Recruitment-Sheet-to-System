import { useEffect, useState } from 'react';
import DataTable from '../../components/DataTable.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import FilterBar, { FilterSelect } from '../../components/FilterBar.jsx';
import FormField from '../../components/FormField.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import Notice from '../../components/Notice.jsx';
import Pagination from '../../components/Pagination.jsx';
import SearchInput from '../../components/SearchInput.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { useApi } from '../../hooks/useApi.js';
import { listHistorical, loadOptions, loadSummary } from './api.js';
import { COLUMNS, NONE, flagLabel } from './fields.js';

// The imported historical interview log, exactly as it was in the file. Read
// only. Records needing a person's attention are marked, never hidden.
const DETAIL_FIELDS = [
  ['Interview date (as in file)', 'interviewDateText'],
  ['Candidate name', 'candidateName'],
  ['Contact number', 'contactNumber'],
  ['Position', 'position'],
  ['Source', 'source'],
  ['Mode', 'mode'],
  ['Original status', 'originalStatus'],
  ['Remarks', 'remarks'],
  ['Other value in file', 'extraValue'],
];

const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;

// A cell the file left empty is shown as a dash, never as invented text.
const cell = (value) => (value === null || value === undefined || value === '' ? '--' : value);

const optionList = (items) =>
  (items ?? []).map(({ value, count }) => ({
    value: value === null ? NONE : value,
    label: `${value === null ? '(blank)' : value} (${count})`,
  }));

function toRow(item, onOpen) {
  return {
    id: item.id,
    date: cell(item.interviewDateText),
    name: cell(item.candidateName),
    phone: cell(item.contactNumber),
    source: cell(item.source),
    mode: cell(item.mode),
    position: cell(item.position),
    status: cell(item.originalStatus),
    remarks: cell(item.remarks),
    details: (
      <button
        type="button"
        className="button"
        onClick={() => onOpen(item)}
        aria-label={`Details for record ${item.recordNumber}`}
      >
        Details
      </button>
    ),
    review:
      item.reviewFlags.length === 0 ? (
        '--'
      ) : (
        <span className="table-actions">
          {item.reviewFlags.map((flag) => (
            <StatusBadge key={flag} tone="warning">
              {flagLabel(flag)}
            </StatusBadge>
          ))}
        </span>
      ),
  };
}

// The records table with its search and filters. Used by the Historical
// Interviews page and by the Candidate List's historical view, so both show
// the same data through the same read-only, permission-checked API.
export default function HistoricalRecordsPanel() {
  const [searchText, setSearchText] = useState('');
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({
    search: '',
    status: '',
    source: '',
    mode: '',
    position: '',
    flag: '',
    review: false,
    dateFrom: '',
    dateTo: '',
    page: 1,
  });
  const setFilter = (name, value) => setFilters((old) => ({ ...old, [name]: value, page: 1 }));

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((old) =>
        old.search === searchText.trim() ? old : { ...old, search: searchText.trim(), page: 1 },
      );
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const summary = useApi(loadSummary, []);
  const options = useApi(loadOptions, []);
  const list = useApi(
    () => listHistorical({ ...filters, review: filters.review ? 'true' : '', pageSize: PAGE_SIZE }),
    [
      filters.search,
      filters.status,
      filters.source,
      filters.mode,
      filters.position,
      filters.flag,
      filters.review,
      filters.dateFrom,
      filters.dateTo,
      filters.page,
    ],
  );

  // The tables exist only once migration 015 has been applied.
  if (list.status === 'ready' && list.data?.unavailable) {
    return (
      <>
        <Notice tone="info" title="Not enabled in this database yet">
          Historical interview records are switched off until the historical tables have been
          approved and created, and a file has been imported.
        </Notice>
      </>
    );
  }

  const data = list.status === 'ready' ? list.data : null;
  const stats = summary.status === 'ready' && !summary.data?.unavailable ? summary.data : null;
  const choices = options.status === 'ready' && !options.data?.unavailable ? options.data : null;
  const isFiltered = Boolean(
    filters.search ||
    filters.status ||
    filters.source ||
    filters.mode ||
    filters.position ||
    filters.flag ||
    filters.review ||
    filters.dateFrom ||
    filters.dateTo,
  );

  return (
    <>
      <Notice tone="info" title="Historical records, shown as they were in the file">
        Each row is one interview-log entry, not a unique candidate: the same person can appear more
        than once, and no candidate profile is created from it. Values are not corrected, merged or
        converted. A phone number, date or status that looks unusual is marked for review and left
        exactly as it was. These records never create emails, reminders, offers or employees.
      </Notice>

      {stats && (
        <p className="field__hint">
          {stats.records} record{stats.records === 1 ? '' : 's'} imported, {stats.needingReview}{' '}
          need review, from {stats.batches.length} file{stats.batches.length === 1 ? '' : 's'}.
        </p>
      )}

      <section className="panel">
        <FilterBar label="Historical interview filters">
          <SearchInput
            label="Search"
            placeholder="Name, phone, position, status or remarks"
            value={searchText}
            onChange={setSearchText}
          />
          <FilterSelect
            label="Position"
            value={filters.position}
            onChange={(value) => setFilter('position', value)}
            options={optionList(choices?.positions)}
          />
          <FilterSelect
            label="Original status"
            value={filters.status}
            onChange={(value) => setFilter('status', value)}
            options={optionList(choices?.statuses)}
          />
          <FilterSelect
            label="Source"
            value={filters.source}
            onChange={(value) => setFilter('source', value)}
            options={optionList(choices?.sources)}
          />
          <FilterSelect
            label="Mode"
            value={filters.mode}
            onChange={(value) => setFilter('mode', value)}
            options={optionList(choices?.modes)}
          />
          <FilterSelect
            label="Review reason"
            value={filters.flag}
            onChange={(value) => setFilter('flag', value)}
            options={(choices?.flags ?? []).map(({ flag, count }) => ({
              value: flag,
              label: `${flagLabel(flag)} (${count})`,
            }))}
          />
          <FormField
            label="Interview date from"
            type="date"
            value={filters.dateFrom}
            onChange={(event) => setFilter('dateFrom', event.target.value)}
          />
          <FormField
            label="Interview date to"
            type="date"
            value={filters.dateTo}
            onChange={(event) => setFilter('dateTo', event.target.value)}
          />
          <FormField
            label="Needs review only"
            type="checkbox"
            checked={filters.review}
            onChange={(event) => setFilter('review', event.target.checked)}
          />
        </FilterBar>

        {list.status === 'loading' && <LoadingState message="Loading historical records…" />}

        {list.status === 'forbidden' && (
          <ErrorState
            title="You do not have permission to view historical interviews"
            message="Ask an administrator if you need access."
          />
        )}

        {list.status === 'error' && (
          <ErrorState
            title="The historical records could not be loaded"
            message="Check your connection and try again."
            onRetry={list.reload}
          />
        )}

        {data && (
          <>
            <DataTable
              caption="Historical interview records"
              columns={COLUMNS}
              rows={data.items.map((item) => toRow(item, setSelected))}
              emptyTitle={isFiltered ? 'No records match' : 'No historical records yet'}
              emptyMessage={
                isFiltered
                  ? 'Try a different search or clear the filters.'
                  : 'No interview log file has been imported into this database.'
              }
            />
            {selected && (
              <section className="panel" aria-label="Historical record details">
                <h3>Historical record {selected.recordNumber}</h3>
                <p className="field__hint">
                  Exactly as stored from the imported file. This is an interview-log entry, not a
                  candidate profile.
                </p>
                <dl>
                  {DETAIL_FIELDS.map(([label, key]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>{cell(selected[key])}</dd>
                    </div>
                  ))}
                  <div>
                    <dt>Review</dt>
                    <dd>
                      {selected.reviewFlags.length === 0
                        ? 'None'
                        : selected.reviewFlags.map(flagLabel).join(', ')}
                    </dd>
                  </div>
                </dl>
                <button type="button" className="button" onClick={() => setSelected(null)}>
                  Close details
                </button>
              </section>
            )}
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPageChange={(next) => setFilters((old) => ({ ...old, page: next }))}
            />
          </>
        )}
      </section>
    </>
  );
}

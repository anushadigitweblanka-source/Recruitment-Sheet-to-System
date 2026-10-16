import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import DataTable from '../../components/DataTable.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import FilterBar, { FilterSelect } from '../../components/FilterBar.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import Notice from '../../components/Notice.jsx';
import Pagination from '../../components/Pagination.jsx';
import SearchInput from '../../components/SearchInput.jsx';
import { useApi } from '../../hooks/useApi.js';
import { listHistorical, loadOptions } from './api.js';
import { NONE, flagLabel } from './fields.js';

// Joining Verification Pending: imported interview-log entries whose original
// status is exactly "Selected". Being Selected is not joining, so these are NOT
// employees. This panel only reads; nothing here creates an employee, offer,
// notification or candidate, and no joining date, Candidate ID or lifecycle
// phase is invented. Records are never merged, even when a phone number repeats.
const SELECTED = 'Selected';
const PAGE_SIZE = 10;
const SEARCH_DELAY_MS = 300;

const COLUMNS = [
  { key: 'name', label: 'Candidate Name' },
  { key: 'phone', label: 'Contact Number' },
  { key: 'position', label: 'Position' },
  { key: 'date', label: 'Interview Date' },
  { key: 'status', label: 'Original Status' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'details', label: 'Details' },
];

const DETAIL_FIELDS = [
  ['Interview date (as in file)', 'interviewDateText'],
  ['Candidate name', 'candidateName'],
  ['Contact number', 'contactNumber'],
  ['Position', 'position'],
  ['Source', 'source'],
  ['Mode', 'mode'],
  ['Original status', 'originalStatus'],
  ['Remarks', 'remarks'],
];

// A cell the file left empty is shown as a dash, never as invented text.
const cell = (value) => (value === null || value === undefined || value === '' ? '--' : value);

const optionList = (items) =>
  (items ?? []).map(({ value, count }) => ({
    value: value === null ? NONE : value,
    label: `${value === null ? '(blank)' : value} (${count})`,
  }));

export default function JoiningVerificationPanel() {
  const [searchText, setSearchText] = useState('');
  const [selected, setSelected] = useState(null);
  const [filters, setFilters] = useState({
    search: '',
    position: '',
    source: '',
    mode: '',
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

  // The filter lists count only the Selected records, matching what is listed.
  const options = useApi(() => loadOptions({ status: SELECTED }), []);
  const list = useApi(
    () => listHistorical({ ...filters, status: SELECTED, pageSize: PAGE_SIZE }),
    [filters.search, filters.position, filters.source, filters.mode, filters.page],
  );

  const choices = options.status === 'ready' && !options.data?.unavailable ? options.data : null;
  const data = list.status === 'ready' && !list.data?.unavailable ? list.data : null;
  const isFiltered = Boolean(filters.search || filters.position || filters.source || filters.mode);

  const rows = (data?.items ?? []).map((item) => ({
    id: item.id,
    name: cell(item.candidateName),
    phone: cell(item.contactNumber),
    position: cell(item.position),
    date: cell(item.interviewDateText),
    status: cell(item.originalStatus),
    remarks: cell(item.remarks),
    details: (
      <button
        type="button"
        className="button"
        onClick={() => setSelected(item)}
        aria-label={`Details for historical record ${item.recordNumber}`}
      >
        Details
      </button>
    ),
  }));

  return (
    <section className="panel" aria-labelledby="joining-verification-title">
      <h2 id="joining-verification-title" className="panel__title">
        Joining Verification Pending
      </h2>
      <Notice tone="info" title="Selected in an interview, joining not verified">
        These are entries in the imported interview log whose original status is Selected. Being
        marked Selected does not mean the person joined, so none of them is counted as an employee
        or in the Evaluation, Probation, Junior or Senior phases, which come only from verified
        employee records. One person can appear more than once and records are never merged. Nothing
        here creates an employee, offer or notification.
      </Notice>

      {data && (
        <p className="field__hint" data-testid="selected-total">
          {data.total} {filters.search || isFiltered ? 'matching ' : ''}Selected interview record
          {data.total === 1 ? '' : 's'}
          {isFiltered ? ' (filtered)' : ' in the imported log'}.
        </p>
      )}

      <FilterBar label="Historical Selected filters">
        <SearchInput
          label="Search selected records"
          placeholder="Name, phone, position or remarks"
          value={searchText}
          onChange={setSearchText}
        />
        <FilterSelect
          label="Selected position"
          value={filters.position}
          onChange={(value) => setFilter('position', value)}
          options={optionList(choices?.positions)}
        />
        <FilterSelect
          label="Selected source"
          value={filters.source}
          onChange={(value) => setFilter('source', value)}
          options={optionList(choices?.sources)}
        />
        <FilterSelect
          label="Selected mode"
          value={filters.mode}
          onChange={(value) => setFilter('mode', value)}
          options={optionList(choices?.modes)}
        />
      </FilterBar>

      {list.status === 'loading' && <LoadingState message="Loading selected records…" />}
      {list.status === 'forbidden' && (
        <ErrorState
          title="You do not have permission to view historical records"
          message="Ask an administrator if you need access."
        />
      )}
      {list.status === 'error' && (
        <ErrorState
          title="The selected records could not be loaded"
          message="Check your connection and try again."
          onRetry={list.reload}
        />
      )}

      {data && (
        <>
          <DataTable
            caption="Joining verification pending"
            columns={COLUMNS}
            rows={rows}
            emptyTitle={isFiltered ? 'No selected records match' : 'No selected records yet'}
            emptyMessage={
              isFiltered
                ? 'Try a different search or clear the filters.'
                : 'No imported interview record has the status Selected.'
            }
          />
          {selected && (
            <section className="panel" aria-label="Historical selected record details">
              <h3>Historical record {selected.recordNumber}</h3>
              <p className="field__hint">
                Exactly as stored from the imported file. This is an interview-log entry, not a
                candidate profile or an employee.
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
              <p className="field__hint">
                To confirm that this person joined, HR checks the facts first, then finds or
                registers the matching candidate in the <Link to="/candidates">Candidate List</Link>{' '}
                and records the offer and the verified joining date through the normal offer
                workflow. The lifecycle phase then follows from that confirmed joining. No joining
                date, Candidate ID or phase is filled in from this record.
              </p>
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
  );
}

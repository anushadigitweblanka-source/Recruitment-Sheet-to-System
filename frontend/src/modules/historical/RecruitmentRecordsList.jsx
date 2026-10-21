import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../auth/AuthContext.jsx';
import DataTable from '../../components/DataTable.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import FilterBar, { FilterSelect } from '../../components/FilterBar.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import Pagination from '../../components/Pagination.jsx';
import SearchInput from '../../components/SearchInput.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { useApi } from '../../hooks/useApi.js';
import { listRecords, loadRecordOptions } from './api.js';
import { NONE, flagLabel } from './fields.js';

// Recruitment Records: one read-only list holding the imported historical
// interview records and the live candidates (including anyone added with Add
// Candidate). A live candidate has a Candidate ID and View / Edit links; an
// imported record keeps exactly the values from the file and has Details.
// Nothing here creates a candidate or an interview.
const PAGE_SIZE = 25;
const SEARCH_DELAY_MS = 300;

const COLUMNS = [
  { key: 'candidateId', label: 'Candidate ID' },
  { key: 'name', label: 'Candidate Name' },
  { key: 'phone', label: 'Contact Number' },
  { key: 'position', label: 'Position' },
  { key: 'source', label: 'Source' },
  { key: 'date', label: 'Date' },
  { key: 'mode', label: 'Mode' },
  { key: 'status', label: 'Status' },
  { key: 'remarks', label: 'Remarks', className: 'data-table__wrap' },
  { key: 'review', label: 'Review' },
  { key: 'actions', label: 'Actions', className: 'data-table__sticky-end' },
];

const DETAIL_FIELDS = [
  ['Interview date (as in file)', 'date'],
  ['Candidate name', 'candidateName'],
  ['Contact number', 'contactNumber'],
  ['Position', 'position'],
  ['Source', 'source'],
  ['Mode', 'mode'],
  ['Original status', 'status'],
  ['Remarks', 'remarks'],
  ['Other value in file', 'extraValue'],
];

// A cell the file left empty is shown as a dash, never as invented text.
const cell = (value) => (value === null || value === undefined || value === '' ? '--' : value);

const optionList = (items) =>
  (items ?? []).map(({ value, count }) => ({
    value: value === null ? NONE : value,
    label: `${value === null ? '(blank)' : value} (${count})`,
  }));

function toRow(item, onOpen, canEdit) {
  const isCandidate = item.kind === 'candidate';
  return {
    id: `${item.kind}-${item.id}`,
    candidateId: isCandidate ? <Link to={`/candidates/${item.id}`}>{item.candidateId}</Link> : '--',
    name: cell(item.candidateName),
    phone: cell(item.contactNumber),
    position: cell(item.position),
    source: cell(item.source),
    date: cell(item.date),
    mode: cell(item.mode),
    status: isCandidate ? <StatusBadge tone="info">{item.status}</StatusBadge> : cell(item.status),
    remarks: cell(item.remarks),
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
    actions: isCandidate ? (
      <span className="table-actions">
        <Link to={`/candidates/${item.id}`} aria-label={`View details of ${item.candidateName}`}>
          View Details
        </Link>
        {canEdit && (
          <Link to={`/candidates/${item.id}/edit`} aria-label={`Edit ${item.candidateName}`}>
            Edit
          </Link>
        )}
      </span>
    ) : (
      <button
        type="button"
        className="button"
        onClick={(event) => onOpen(item, event.currentTarget)}
        aria-label={`View details of record ${item.recordNumber}`}
      >
        View Details
      </button>
    ),
  };
}

export default function RecruitmentRecordsList() {
  const { user } = useAuth();
  const canEdit = (user?.permissions ?? []).includes('candidates.edit');
  const [searchText, setSearchText] = useState('');
  const [selected, setSelected] = useState(null);
  const panelRef = useRef(null);
  const headingRef = useRef(null);
  const openerRef = useRef(null);
  const [filters, setFilters] = useState({
    search: '',
    position: '',
    source: '',
    status: '',
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

  // An imported record opens in a panel above the table. With a full page of rows
  // a panel under the table would be off screen, so it is scrolled into view and
  // its heading takes focus; closing it returns focus to the button that opened it.
  // The panel is cleared when the list changes, so it never shows a record that
  // is no longer on the page.
  const open = (item, opener) => {
    openerRef.current = opener;
    setSelected(item);
  };
  const close = () => {
    setSelected(null);
    const opener = openerRef.current;
    if (opener?.isConnected) opener.focus();
  };
  useEffect(() => {
    if (!selected) return;
    panelRef.current?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    headingRef.current?.focus();
  }, [selected]);
  useEffect(() => {
    setSelected(null);
  }, [filters.search, filters.position, filters.source, filters.status, filters.page]);

  const options = useApi(loadRecordOptions, []);
  const list = useApi(
    () => listRecords({ ...filters, pageSize: PAGE_SIZE }),
    [filters.search, filters.position, filters.source, filters.status, filters.page],
    { refreshOnFocus: true },
  );

  const choices = options.status === 'ready' && !options.data?.unavailable ? options.data : null;
  const data = list.status === 'ready' && !list.data?.unavailable ? list.data : null;
  const isFiltered = Boolean(
    filters.search || filters.position || filters.source || filters.status,
  );

  return (
    <section className="panel">
      <FilterBar label="Recruitment record filters">
        <SearchInput
          label="Search"
          placeholder="Name, phone, Candidate ID, position, status or remarks"
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
          label="Source"
          value={filters.source}
          onChange={(value) => setFilter('source', value)}
          options={optionList(choices?.sources)}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(value) => setFilter('status', value)}
          options={optionList(choices?.statuses)}
        />
      </FilterBar>

      {list.status === 'loading' && <LoadingState message="Loading recruitment records…" />}

      {list.status === 'forbidden' && (
        <ErrorState
          title="You do not have permission to view recruitment records"
          message="Ask an administrator if you need access."
        />
      )}

      {list.status === 'error' && (
        <ErrorState
          title="The recruitment records could not be loaded"
          message="Check your connection and try again."
          onRetry={list.reload}
        />
      )}

      {data && (
        <>
          {selected && (
            <section className="panel" aria-label="Historical record details" ref={panelRef}>
              <h3 tabIndex={-1} ref={headingRef}>
                Historical record {selected.recordNumber}
              </h3>
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
              <button type="button" className="button" onClick={close}>
                Close details
              </button>
            </section>
          )}
          <DataTable
            caption="Recruitment records"
            columns={COLUMNS}
            rows={data.items.map((item) => toRow(item, open, canEdit))}
            emptyTitle={isFiltered ? 'No records match' : 'No recruitment records yet'}
            emptyMessage={
              isFiltered
                ? 'Try a different search or clear the filters.'
                : 'Use Add Candidate to register the first one.'
            }
          />
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

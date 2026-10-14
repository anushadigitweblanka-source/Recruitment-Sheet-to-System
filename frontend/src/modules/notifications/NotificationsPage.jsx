import { useEffect, useState } from 'react';
import DataTable from '../../components/DataTable.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import FilterBar, { FilterSelect } from '../../components/FilterBar.jsx';
import FormField from '../../components/FormField.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Pagination from '../../components/Pagination.jsx';
import SearchInput from '../../components/SearchInput.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatDateTime } from '../../utils/format.js';
import { listNotifications, runScheduler } from './api.js';
import {
  NOTIFICATION_COLUMNS,
  NOTIFICATION_STATUS_LABELS,
  NOTIFICATION_STATUS_OPTIONS,
  NOTIFICATION_STATUS_TONES,
  NOTIFICATION_TYPE_OPTIONS,
  typeLabel,
} from './fields.js';

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

function toRow(item) {
  return {
    id: item.id,
    subject: `${item.candidate.candidateCode} — ${item.candidate.fullName}`,
    type: typeLabel(item.type),
    dueAt: formatDateTime(item.dueAt),
    sendAt: formatDateTime(item.sendAt),
    sentAt: formatDateTime(item.sentAt) ?? '--',
    status: (
      <StatusBadge tone={NOTIFICATION_STATUS_TONES[item.status]}>
        {NOTIFICATION_STATUS_LABELS[item.status]}
      </StatusBadge>
    ),
    recipient: item.recipients.join(', '),
  };
}

// Runs the 15-minute job now, so a reminder can be checked without waiting.
// The backend allows this in development only.
function RunNow({ onDone }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);

  async function handleRun() {
    setRunning(true);
    setResult(null);
    let res;
    try {
      res = await runScheduler();
    } catch {
      res = null;
    }
    setRunning(false);
    if (res?.ok) {
      setResult({
        tone: 'success',
        text: `Run finished: ${res.body.sent} sent, ${res.body.failed} failed, ${res.body.checked} checked.`,
      });
      onDone();
    } else if (res?.status === 403) {
      setResult({
        tone: 'danger',
        text: 'Only an administrator can run the job, and only in development.',
      });
    } else {
      setResult({ tone: 'danger', text: 'The run could not be started. Try again.' });
    }
  }

  return (
    <>
      <button type="button" className="button" onClick={handleRun} disabled={running}>
        {running ? 'Running…' : 'Run sending job now (development)'}
      </button>
      {result && (
        <Notice tone={result.tone} role="status">
          {result.text}
        </Notice>
      )}
    </>
  );
}

export default function NotificationsPage({ page }) {
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState({
    search: '',
    type: '',
    status: '',
    dueFrom: '',
    dueTo: '',
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

  const list = useApi(
    () => listNotifications({ ...filters, pageSize: PAGE_SIZE }),
    [filters.search, filters.type, filters.status, filters.dueFrom, filters.dueTo, filters.page],
  );
  const isFiltered = Boolean(
    filters.search || filters.type || filters.status || filters.dueFrom || filters.dueTo,
  );

  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      <Notice tone="info" title="Sending rule (from the task guide)">
        A reminder is sent when its Send At time has passed and it has not been sent yet:{' '}
        <code>send_at &lt;= current time AND sent_at IS NULL</code>. Due At is the deadline itself
        (17:30 office time); Send At is 24 hours before it. The job runs every 15 minutes.
        {list.status === 'ready' && list.data.mailMode === 'development' && (
          <> Mail is in development mode: no real email leaves this application.</>
        )}
      </Notice>

      <section className="panel">
        <FilterBar label="Notification filters">
          <SearchInput
            label="Search"
            placeholder="Candidate name or ID"
            value={searchText}
            onChange={setSearchText}
          />
          <FilterSelect
            label="Notification Type"
            value={filters.type}
            onChange={(value) => setFilter('type', value)}
            options={NOTIFICATION_TYPE_OPTIONS}
          />
          <FilterSelect
            label="Status"
            value={filters.status}
            onChange={(value) => setFilter('status', value)}
            options={NOTIFICATION_STATUS_OPTIONS}
          />
          <FormField
            label="Due from"
            type="date"
            value={filters.dueFrom}
            onChange={(event) => setFilter('dueFrom', event.target.value)}
          />
          <FormField
            label="Due to"
            type="date"
            value={filters.dueTo}
            onChange={(event) => setFilter('dueTo', event.target.value)}
          />
        </FilterBar>

        <RunNow onDone={list.reload} />

        {list.status === 'loading' && <LoadingState message="Loading notifications…" />}
        {list.status === 'forbidden' && (
          <ErrorState title="You do not have permission to view notifications" />
        )}
        {list.status === 'error' && (
          <ErrorState title="The notifications could not be loaded" onRetry={list.reload} />
        )}

        {list.status === 'ready' && (
          <>
            <DataTable
              caption="Notifications"
              columns={NOTIFICATION_COLUMNS}
              rows={list.data.items.map(toRow)}
              emptyTitle={isFiltered ? 'No notifications match' : 'No notifications yet'}
              emptyMessage={
                isFiltered
                  ? 'Try a different search or clear the filters.'
                  : 'Reminders appear here once they are scheduled. Automatic scheduling is waiting on the recipient rules (see the module notes).'
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

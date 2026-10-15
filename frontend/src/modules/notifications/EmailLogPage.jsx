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
import EmailApprovalsPanel from './EmailApprovalsPanel.jsx';
import { listEmailLog, resendEmail } from './api.js';
import { EMAIL_LOG_COLUMNS, LOG_STATUS_LABELS, LOG_STATUS_TONES } from './fields.js';

const PAGE_SIZE = 20;
const SEARCH_DELAY_MS = 300;

const LOG_STATUS_FILTER_OPTIONS = Object.entries(LOG_STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

export default function EmailLogPage({ page }) {
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState({ recipient: '', status: '', from: '', to: '', page: 1 });
  const [resending, setResending] = useState(null); // the id being resent
  const [notice, setNotice] = useState(null);

  const setFilter = (name, value) => setFilters((old) => ({ ...old, [name]: value, page: 1 }));

  useEffect(() => {
    const timer = setTimeout(() => {
      setFilters((old) =>
        old.recipient === searchText.trim()
          ? old
          : { ...old, recipient: searchText.trim(), page: 1 },
      );
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [searchText]);

  const list = useApi(
    () => listEmailLog({ ...filters, pageSize: PAGE_SIZE }),
    [filters.recipient, filters.status, filters.from, filters.to, filters.page],
  );

  // "The same template is never sent twice to the same candidate unless it
  // is explicitly resent." This button is that explicit resend.
  async function handleResend(entry) {
    setResending(entry.id);
    setNotice(null);
    let res;
    try {
      res = await resendEmail(entry.id);
    } catch {
      res = null;
    }
    setResending(null);

    if (res?.ok) {
      setNotice({
        tone: 'success',
        text: `Resent "${entry.subjectSent}". A new log row records it.`,
      });
      list.reload();
    } else if (res?.status === 403) {
      setNotice({ tone: 'danger', text: 'Only an administrator can resend a mail.' });
    } else if (res?.status === 422) {
      setNotice({ tone: 'danger', text: res.body.fields?.resend ?? 'This mail cannot be resent.' });
    } else {
      setNotice({ tone: 'danger', text: 'The resend did not go through. Try again.' });
    }
  }

  const toRow = (entry) => ({
    id: entry.id,
    candidate: entry.candidate
      ? `${entry.candidate.candidateCode} — ${entry.candidate.fullName}`
      : '--',
    template: entry.template.type,
    recipient: entry.toAddresses.join(', '),
    sentAt: formatDateTime(entry.sentAt) ?? '--',
    status: (
      <StatusBadge tone={LOG_STATUS_TONES[entry.status]}>
        {LOG_STATUS_LABELS[entry.status]}
      </StatusBadge>
    ),
    error: entry.error ?? '--',
    resend: entry.isResend ? `Resent${entry.sentBy ? ` by ${entry.sentBy}` : ''}` : '--',
    actions:
      entry.status === 'queued' ? (
        '--'
      ) : (
        <button
          type="button"
          className="button-link"
          onClick={() => handleResend(entry)}
          disabled={resending !== null}
          aria-label={`Resend mail ${entry.id}`}
        >
          {resending === entry.id ? 'Resending…' : 'Resend'}
        </button>
      ),
  });

  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      <Notice tone="info">
        The same template is never sent twice to the same candidate unless it is explicitly resent;
        a resend is its own row here, marked in the Resend column.
        {list.status === 'ready' && list.data.mailMode === 'development' && (
          <> Mail is in development mode: no real email leaves this application.</>
        )}
      </Notice>

      <EmailApprovalsPanel onChanged={list.reload} />

      {notice && (
        <Notice tone={notice.tone} role="status">
          {notice.text}
        </Notice>
      )}

      <section className="panel">
        <FilterBar label="Email log filters">
          <SearchInput
            label="Recipient"
            placeholder="Email address"
            value={searchText}
            onChange={setSearchText}
          />
          <FilterSelect
            label="Status"
            value={filters.status}
            onChange={(value) => setFilter('status', value)}
            options={LOG_STATUS_FILTER_OPTIONS}
          />
          <FormField
            label="From"
            type="date"
            value={filters.from}
            onChange={(event) => setFilter('from', event.target.value)}
          />
          <FormField
            label="To"
            type="date"
            value={filters.to}
            onChange={(event) => setFilter('to', event.target.value)}
          />
        </FilterBar>

        {list.status === 'loading' && <LoadingState message="Loading the email log…" />}
        {list.status === 'forbidden' && (
          <ErrorState title="You do not have permission to view the email log" />
        )}
        {list.status === 'error' && (
          <ErrorState title="The email log could not be loaded" onRetry={list.reload} />
        )}

        {list.status === 'ready' && (
          <>
            <DataTable
              caption="Email log"
              columns={EMAIL_LOG_COLUMNS}
              rows={list.data.items.map(toRow)}
              emptyTitle="No mails yet"
              emptyMessage="Every mail the system tries to send is recorded here, including failures."
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

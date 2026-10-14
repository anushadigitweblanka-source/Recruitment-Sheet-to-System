import { useState } from 'react';
import { listAuditLog } from '../api/admin.js';
import DataTable from '../components/DataTable.jsx';
import ErrorState from '../components/ErrorState.jsx';
import FilterBar from '../components/FilterBar.jsx';
import FormField from '../components/FormField.jsx';
import LoadingState from '../components/LoadingState.jsx';
import PageHeader from '../components/PageHeader.jsx';
import Pagination from '../components/Pagination.jsx';
import { useApi } from '../hooks/useApi.js';
import { formatDateTime } from '../utils/format.js';

// Read-only: the audit log is append-only by design, so there is nothing to
// edit here. Payloads are safe to show - the writer refuses passwords,
// hashes, tokens, secrets and salaries before a row is ever stored.

const COLUMNS = [
  { key: 'occurredAt', label: 'Date and time' },
  { key: 'actor', label: 'User' },
  { key: 'action', label: 'Action' },
  { key: 'entity', label: 'Entity' },
  { key: 'summary', label: 'Summary' },
];

// A compact one-line description of what changed, from the stored payloads.
function summarize(item) {
  const parts = [];
  if (item.details) parts.push(JSON.stringify(item.details));
  if (item.oldValues || item.newValues) {
    parts.push(`${JSON.stringify(item.oldValues ?? {})} → ${JSON.stringify(item.newValues ?? {})}`);
  }
  const text = parts.join(' ');
  return text.length > 160 ? `${text.slice(0, 157)}…` : text || '--';
}

export default function AuditLogPage({ page }) {
  const [filters, setFilters] = useState({ action: '', entityType: '', from: '', to: '', page: 1 });
  const setFilter = (name, value) => setFilters((old) => ({ ...old, [name]: value, page: 1 }));
  const result = useApi(
    () => listAuditLog(filters),
    [filters.action, filters.entityType, filters.from, filters.to, filters.page],
  );

  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      <section className="panel">
        <FilterBar label="Audit log filters">
          <FormField
            label="Action code"
            value={filters.action}
            onChange={(event) => setFilter('action', event.target.value.toUpperCase().trim())}
          />
          <FormField
            label="Entity type"
            value={filters.entityType}
            onChange={(event) => setFilter('entityType', event.target.value.toLowerCase().trim())}
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

        {result.status === 'loading' && <LoadingState message="Loading audit log…" />}
        {result.status === 'forbidden' && (
          <ErrorState
            title="Administrators only"
            message="Only an administrator can read the audit log."
          />
        )}
        {result.status === 'error' && (
          <ErrorState
            title="The audit log could not be loaded"
            message="The entries could not be read from the server."
            onRetry={result.reload}
          />
        )}
        {result.status === 'ready' && (
          <>
            <DataTable
              caption="Audit log"
              columns={COLUMNS}
              rows={result.data.items.map((item) => ({
                id: item.id,
                occurredAt: formatDateTime(item.occurredAt),
                actor: item.actor ? item.actor.name : 'System',
                action: item.action,
                entity: item.entityType
                  ? `${item.entityType}${item.entityId ? ` #${item.entityId}` : ''}`
                  : '--',
                summary: summarize(item),
              }))}
              emptyTitle="No audit entries match"
              emptyMessage="No audit entry matches the chosen filters."
            />
            <Pagination
              page={result.data.page}
              pageSize={result.data.pageSize}
              total={result.data.total}
              onPageChange={(next) => setFilters((old) => ({ ...old, page: next }))}
            />
          </>
        )}
      </section>
    </>
  );
}

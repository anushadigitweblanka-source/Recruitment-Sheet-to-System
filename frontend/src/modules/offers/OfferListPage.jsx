import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { listSalaries, saveSalary } from '../../api/stage11.js';
import { useAuth } from '../../auth/AuthContext.jsx';
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
import { formatDate } from '../../utils/format.js';
import { listOffers } from './api.js';
import {
  EMAIL_STATUS_UNAVAILABLE,
  OFFER_COLUMNS,
  OFFER_STATUS_LABELS,
  OFFER_STATUS_OPTIONS,
  OFFER_STATUS_TONES,
  attendedLabel,
  workModeLabel,
} from './fields.js';

const PAGE_SIZE = 20;

const LKR = new Intl.NumberFormat('en-LK', {
  style: 'currency',
  currency: 'LKR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// The salary column sits before Email Status. It exists only for people who
// hold salary.view; for everyone else the column, the values and the actions
// are not built at all.
const SALARY_COLUMN = { key: 'salary', label: 'Offered Salary (LKR)' };
function columnsFor(showSalary) {
  if (!showSalary) return OFFER_COLUMNS;
  const at = OFFER_COLUMNS.findIndex((column) => column.key === 'emailStatus');
  return [...OFFER_COLUMNS.slice(0, at), SALARY_COLUMN, ...OFFER_COLUMNS.slice(at)];
}

// Inline editor for one row. Saving uses the existing salary endpoint, which
// checks salary.edit and audits the change without the amount.
function SalaryEditor({ candidateId, name, initial, onSaved, onCancel }) {
  const [value, setValue] = useState(initial === null ? '' : String(initial));
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    const res = await saveSalary(candidateId, value.trim()).catch(() => null);
    setSaving(false);
    if (res?.ok) onSaved(res.body.salary.salaryLkr);
    else if (res?.status === 422)
      setError(res.body.fields?.salaryLkr ?? 'The amount is not valid.');
    else if (res?.status === 403) setError('Only the Main User can change salary.');
    else setError('The salary could not be saved. Try again.');
  }

  return (
    <div className="salary-editor">
      <FormField
        label={`Salary (LKR) for ${name}`}
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        disabled={saving}
        error={error}
      />
      <span className="table-actions">
        <button
          type="button"
          className="button button--primary"
          disabled={saving || value.trim() === ''}
          onClick={save}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="button button--secondary"
          disabled={saving}
          onClick={onCancel}
        >
          Cancel
        </button>
      </span>
    </div>
  );
}
const SEARCH_DELAY_MS = 300;

const STATUS_FILTER_OPTIONS = [
  ...OFFER_STATUS_OPTIONS,
  { value: 'pending', label: 'No status yet' },
];

// One row per candidate. A selected candidate waiting for their offer has no
// offer record yet: the row shows the position they applied for and offers
// "Prepare offer".
// `salary` is { show, canEdit, amounts, editingId, setEditingId, onSaved }.
function toRow({ candidate, offer }, salary) {
  const name = `${candidate.candidateCode} — ${candidate.fullName}`;

  return {
    id: candidate.id,
    candidate: offer ? <Link to={`/offers/${offer.id}`}>{name}</Link> : name,
    position: (offer ? offer.position : candidate.position) ?? '--',
    offerDate: formatDate(offer?.offerDate) ?? '--',
    workMode: workModeLabel(offer?.workMode) ?? '--',
    location: offer?.location ?? '--',
    offerStatus: offer?.offerStatus ? (
      <StatusBadge tone={OFFER_STATUS_TONES[offer.offerStatus]}>
        {OFFER_STATUS_LABELS[offer.offerStatus]}
      </StatusBadge>
    ) : (
      <StatusBadge>{offer ? 'Not sent' : 'No offer yet'}</StatusBadge>
    ),
    ...(salary.show
      ? {
          salary: offer ? (
            salary.editingId === candidate.id ? (
              <SalaryEditor
                candidateId={candidate.id}
                name={candidate.fullName}
                initial={salary.amounts[candidate.id] ?? null}
                onSaved={(amount) => salary.onSaved(candidate.id, amount)}
                onCancel={() => salary.setEditingId(null)}
              />
            ) : salary.amounts[candidate.id] === undefined ? (
              '…'
            ) : salary.amounts[candidate.id] === null ? (
              'Not Set'
            ) : (
              LKR.format(salary.amounts[candidate.id])
            )
          ) : (
            '--'
          ),
        }
      : {}),
    emailStatus: EMAIL_STATUS_UNAVAILABLE,
    onboardingDate: formatDate(offer?.onboardingDate) ?? '--',
    attended: attendedLabel(offer?.attended) ?? '--',
    actions: (
      <span className="table-actions">
        {offer ? (
          <>
            <Link to={`/offers/${offer.id}`} aria-label={`View offer of ${candidate.fullName}`}>
              View
            </Link>
            <Link
              to={`/offers/${offer.id}/edit`}
              aria-label={`Edit offer of ${candidate.fullName}`}
            >
              Edit
            </Link>
            {salary.show && salary.canEdit && salary.amounts[candidate.id] !== undefined && (
              <button
                type="button"
                className="button-link"
                onClick={() => salary.setEditingId(candidate.id)}
                aria-label={`${salary.amounts[candidate.id] === null ? 'Add' : 'Edit'} salary of ${candidate.fullName}`}
              >
                {salary.amounts[candidate.id] === null ? 'Add Salary' : 'Edit Salary'}
              </button>
            )}
          </>
        ) : (
          <Link
            to={`/offers/new?candidate=${candidate.id}`}
            aria-label={`Prepare offer for ${candidate.fullName}`}
          >
            Prepare offer
          </Link>
        )}
      </span>
    ),
  };
}

export default function OfferListPage({ page }) {
  const { user } = useAuth();
  const showSalary = Boolean(user?.permissions?.includes('salary.view'));
  const canEditSalary = Boolean(user?.permissions?.includes('salary.edit'));
  const [amounts, setAmounts] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [salaryFailed, setSalaryFailed] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState({
    search: '',
    offerStatus: '',
    onboardingFrom: '',
    onboardingTo: '',
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

  const list = useApi(
    () => listOffers({ ...filters, pageSize: PAGE_SIZE }),
    [
      filters.search,
      filters.offerStatus,
      filters.onboardingFrom,
      filters.onboardingTo,
      filters.page,
    ],
  );
  // The salaries of the offers on this page come from the Main-User-only
  // salary route, never from the offers list. Without salary.view nothing is
  // requested.
  const offerCandidateIds = useMemo(
    () =>
      list.status === 'ready'
        ? list.data.items.filter((row) => row.offer).map((row) => row.candidate.id)
        : [],
    [list.status, list.data],
  );
  useEffect(() => {
    if (!showSalary || offerCandidateIds.length === 0) return undefined;
    let cancelled = false;
    setSalaryFailed(false);
    listSalaries(offerCandidateIds)
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setSalaryFailed(true);
          return;
        }
        setAmounts(Object.fromEntries(res.body.items.map((i) => [i.candidateId, i.salaryLkr])));
      })
      .catch(() => {
        if (!cancelled) setSalaryFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [showSalary, offerCandidateIds]);

  const salary = {
    show: showSalary,
    canEdit: canEditSalary,
    amounts,
    editingId,
    setEditingId,
    onSaved: (candidateId, amount) => {
      setAmounts((old) => ({ ...old, [candidateId]: amount }));
      setEditingId(null);
    },
  };

  const isFiltered = Boolean(
    filters.search || filters.offerStatus || filters.onboardingFrom || filters.onboardingTo,
  );

  return (
    <>
      <PageHeader
        title={page.label}
        description={page.description}
        actions={
          <Link to="/offers/new" className="button button--primary">
            Prepare Offer
          </Link>
        }
      />

      <section className="panel">
        <FilterBar label="Offer filters">
          <SearchInput
            label="Search"
            placeholder="Candidate name or ID"
            value={searchText}
            onChange={setSearchText}
          />
          <FilterSelect
            label="Offer Status"
            value={filters.offerStatus}
            onChange={(value) => setFilter('offerStatus', value)}
            options={STATUS_FILTER_OPTIONS}
          />
          <FormField
            label="Onboarding from"
            type="date"
            value={filters.onboardingFrom}
            onChange={(event) => setFilter('onboardingFrom', event.target.value)}
          />
          <FormField
            label="Onboarding to"
            type="date"
            value={filters.onboardingTo}
            onChange={(event) => setFilter('onboardingTo', event.target.value)}
          />
        </FilterBar>

        {list.status === 'loading' && <LoadingState message="Loading offers…" />}

        {list.status === 'forbidden' && (
          <ErrorState
            title="You do not have permission to view offers"
            message="Ask an administrator if you need access."
          />
        )}

        {list.status === 'error' && (
          <ErrorState
            title="The offers could not be loaded"
            message="Check your connection and try again."
            onRetry={list.reload}
          />
        )}

        {list.status === 'ready' && (
          <>
            {showSalary && salaryFailed && (
              <Notice tone="danger" role="alert">
                The salaries could not be loaded.
              </Notice>
            )}
            <DataTable
              caption="Offers"
              columns={columnsFor(showSalary)}
              rows={list.data.items.map((row) => toRow(row, salary))}
              emptyTitle={isFiltered ? 'No offers match' : 'No offers yet'}
              emptyMessage={
                isFiltered
                  ? 'Try a different search or clear the filters.'
                  : 'A candidate appears here once their direct interview result is Selected.'
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

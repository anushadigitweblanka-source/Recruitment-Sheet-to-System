import { useState } from 'react';
import { loadCandidateLookups } from '../../api/lookups.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import DataTable from '../../components/DataTable.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import FilterBar, { FilterSelect } from '../../components/FilterBar.jsx';
import FormField from '../../components/FormField.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Pagination from '../../components/Pagination.jsx';
import StatCard from '../../components/StatCard.jsx';
import { useApi } from '../../hooks/useApi.js';
import { formatDate, formatDateTime } from '../../utils/format.js';
import {
  candidateStatusReport,
  exitReport,
  exportReport,
  funnelReport,
  onboardingReport,
  positionReport,
  salaryOfferReport,
  sourceReport,
  weeklyReport,
} from './api.js';

// Every figure on this page comes from /api/reports/*; nothing is hardcoded.
// The weekly report is also sent by the Stage 11 scheduler when recipients are set.

const TABS = [
  ['status', 'Candidate Status'],
  ['funnel', 'Funnel'],
  ['sources', 'Sources'],
  ['positions', 'Positions'],
  ['weekly', 'Weekly'],
  ['onboarding', 'Onboarding'],
  ['exit', 'Exit'],
];

// Shown only to people who hold salary.view (the Main User). The server
// enforces it too; hiding the tab is only courtesy.
const SALARY_TAB = ['salary', 'Salary & Offers'];

const PAGE_SIZE = 20;

function ReportState({ result, children }) {
  if (result.status === 'loading') return <LoadingState message="Loading report…" />;
  if (result.status !== 'ready') {
    return (
      <ErrorState
        title="The report could not be loaded"
        message="The figures could not be read from the server."
        onRetry={result.reload}
      />
    );
  }
  return children(result.data);
}

const toOptions = (items, value = (item) => item.id) =>
  (items ?? []).map((item) => ({ value: String(value(item)), label: item.name }));

// Export buttons for one report. The file is built by the backend from the
// SAME dataset and filters as the table on screen, and downloads in place.
const EXPORT_FORMATS = [
  ['xlsx', 'Export Excel'],
  ['csv', 'Export CSV'],
  ['pdf', 'Export PDF'],
];

function ExportButtons({ report, filters = {} }) {
  const [busy, setBusy] = useState(null);
  const [failed, setFailed] = useState(false);

  const download = async (format) => {
    setBusy(format);
    setFailed(false);
    try {
      const res = await exportReport(report, format, filters);
      if (!res.ok) {
        setFailed(true);
        return;
      }
      const url = URL.createObjectURL(res.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = res.filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="filter-bar" role="group" aria-label="Export">
      {EXPORT_FORMATS.map(([format, label]) => (
        <button
          key={format}
          type="button"
          className="button button--secondary"
          disabled={busy !== null}
          onClick={() => download(format)}
        >
          {busy === format ? 'Preparing…' : label}
        </button>
      ))}
      {failed && (
        <Notice tone="danger" role="alert">
          The export could not be prepared. Try again.
        </Notice>
      )}
    </div>
  );
}

function CandidateStatusReport({ lookups }) {
  const [filters, setFilters] = useState({
    stage: '',
    positionId: '',
    sourceId: '',
    from: '',
    to: '',
    page: 1,
  });
  const setFilter = (name, value) => setFilters((old) => ({ ...old, [name]: value, page: 1 }));
  const result = useApi(
    () => candidateStatusReport({ ...filters, pageSize: PAGE_SIZE }),
    [filters.stage, filters.positionId, filters.sourceId, filters.from, filters.to, filters.page],
  );

  return (
    <>
      <FilterBar label="Candidate status filters">
        <FilterSelect
          label="Stage"
          value={filters.stage}
          onChange={(value) => setFilter('stage', value)}
          options={toOptions(lookups?.stages, (stage) => stage.code)}
        />
        <FilterSelect
          label="Position"
          value={filters.positionId}
          onChange={(value) => setFilter('positionId', value)}
          options={toOptions(lookups?.positions)}
        />
        <FilterSelect
          label="Source"
          value={filters.sourceId}
          onChange={(value) => setFilter('sourceId', value)}
          options={toOptions(lookups?.sources)}
        />
        <FormField
          label="Added from"
          type="date"
          value={filters.from}
          onChange={(event) => setFilter('from', event.target.value)}
        />
        <FormField
          label="Added to"
          type="date"
          value={filters.to}
          onChange={(event) => setFilter('to', event.target.value)}
        />
      </FilterBar>
      <ExportButtons
        report="candidate-status"
        filters={{
          stage: filters.stage,
          positionId: filters.positionId,
          sourceId: filters.sourceId,
          from: filters.from,
          to: filters.to,
        }}
      />
      <ReportState result={result}>
        {(data) => (
          <>
            <DataTable
              caption="Candidate status report"
              columns={[
                { key: 'candidate', label: 'Candidate' },
                { key: 'position', label: 'Position' },
                { key: 'source', label: 'Source' },
                { key: 'stage', label: 'Current stage' },
                { key: 'stageChangedAt', label: 'Stage since' },
                { key: 'createdAt', label: 'Added' },
              ]}
              rows={data.items.map((row) => ({
                id: row.id,
                candidate: `${row.fullName} (${row.candidateCode})`,
                position: row.position ?? '--',
                source: row.source ?? '--',
                stage: row.stageName ?? row.stage,
                stageChangedAt: formatDateTime(row.stageChangedAt),
                createdAt: formatDate(row.createdAt),
              }))}
              emptyTitle="No candidates match"
              emptyMessage="No candidate matches the chosen filters."
            />
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPageChange={(page) => setFilters((old) => ({ ...old, page }))}
            />
          </>
        )}
      </ReportState>
    </>
  );
}

function FunnelReport() {
  const [range, setRange] = useState({ from: '', to: '' });
  const result = useApi(() => funnelReport(range), [range.from, range.to]);

  return (
    <>
      <FilterBar label="Funnel filters">
        <FormField
          label="Movement from"
          type="date"
          value={range.from}
          onChange={(event) => setRange((old) => ({ ...old, from: event.target.value }))}
        />
        <FormField
          label="Movement to"
          type="date"
          value={range.to}
          onChange={(event) => setRange((old) => ({ ...old, to: event.target.value }))}
        />
      </FilterBar>
      <ExportButtons report="funnel" filters={range} />
      <ReportState result={result}>
        {(data) => (
          <DataTable
            caption="Funnel report"
            columns={[
              { key: 'stage', label: 'Stage' },
              { key: 'current', label: 'Candidates there now' },
              { key: 'entered', label: 'Entered the stage (period)' },
            ]}
            rows={data.stages.map((row) => ({
              id: row.stage,
              stage: row.stageName,
              current: row.current,
              entered: row.entered,
            }))}
            emptyTitle="No stages"
            emptyMessage="The stage list is empty."
          />
        )}
      </ReportState>
    </>
  );
}

function BreakdownReport({ load, caption, nameLabel, report }) {
  const result = useApi(load, []);
  return (
    <>
      <ExportButtons report={report} />
      <ReportState result={result}>
        {(data) => (
          <DataTable
            caption={caption}
            columns={[
              { key: 'name', label: nameLabel },
              { key: 'total', label: 'Candidates' },
              { key: 'inProgress', label: 'In progress' },
              { key: 'hired', label: 'Joined' },
              { key: 'rejected', label: 'Rejected' },
              { key: 'onHold', label: 'On hold' },
              { key: 'unresponsive', label: 'No show / no response' },
            ]}
            rows={data.items.map((row, index) => ({ id: index, ...row }))}
            emptyTitle="No candidates yet"
            emptyMessage="There are no candidates to report on."
          />
        )}
      </ReportState>
    </>
  );
}

function WeeklyReport() {
  const [weekStart, setWeekStart] = useState('');
  const result = useApi(() => weeklyReport(weekStart ? { weekStart } : {}), [weekStart]);

  return (
    <>
      <Notice tone="info" title="Weekly report">
        The office week runs Monday to Sunday (Asia/Colombo); the default is the last completed
        week. “Applications” counts candidates added in the week — the workbook’s own application
        date is not in the system yet. Scheduled email delivery runs Monday at 08:00 when recipients
        are configured in Settings.
      </Notice>
      <FilterBar label="Weekly report filters">
        <FormField
          label="Week starting (a Monday)"
          type="date"
          value={weekStart}
          onChange={(event) => setWeekStart(event.target.value)}
        />
      </FilterBar>
      <ExportButtons report="weekly" filters={weekStart ? { weekStart } : {}} />
      <ReportState result={result}>
        {(data) => (
          <>
            <p className="section-title">
              Week {formatDate(data.weekStart)} – {formatDate(data.weekEnd)}
            </p>
            <div className="stat-grid">
              <StatCard label="Applications" value={data.applications} />
              <StatCard label="Offers Sent" value={data.offersSent} />
              <StatCard label="Offers Accepted" value={data.offersAccepted} />
              <StatCard label="Joined" value={data.joined} />
              <StatCard label="Rejected" value={data.rejected} />
            </div>
            <DataTable
              caption="Stage movements in the week"
              columns={[
                { key: 'stage', label: 'Moved to stage' },
                { key: 'total', label: 'Candidates' },
              ]}
              rows={data.movements.map((row) => ({
                id: row.stage,
                stage: row.stageName ?? row.stage,
                total: row.total,
              }))}
              emptyTitle="No stage changes"
              emptyMessage="No candidate changed stage in this week."
            />
          </>
        )}
      </ReportState>
    </>
  );
}

function RangeListReport({ load, caption, columns, mapRow, empty, rangeLabels, report }) {
  const [range, setRange] = useState({ from: '', to: '' });
  const result = useApi(() => load(range), [range.from, range.to]);

  return (
    <>
      <FilterBar label={`${caption} filters`}>
        <FormField
          label={rangeLabels[0]}
          type="date"
          value={range.from}
          onChange={(event) => setRange((old) => ({ ...old, from: event.target.value }))}
        />
        <FormField
          label={rangeLabels[1]}
          type="date"
          value={range.to}
          onChange={(event) => setRange((old) => ({ ...old, to: event.target.value }))}
        />
      </FilterBar>
      <ExportButtons report={report} filters={range} />
      <ReportState result={result}>
        {(data) => (
          <DataTable
            caption={caption}
            columns={columns}
            rows={data.items.map(mapRow)}
            emptyTitle={empty.title}
            emptyMessage={empty.message}
          />
        )}
      </ReportState>
    </>
  );
}

const OFFER_STATUS_OPTIONS = [
  { value: 'sent', label: 'Sent' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'pending', label: 'Not sent yet' },
];
const OFFER_STATUS_LABELS = { sent: 'Sent', accepted: 'Accepted' };
const LKR = new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const lkr = (value) => (value === null || value === undefined ? '--' : LKR.format(value));

function SalaryOfferReport({ lookups }) {
  const [filters, setFilters] = useState({
    positionId: '',
    sourceId: '',
    offerStatus: '',
    from: '',
    to: '',
    page: 1,
  });
  const setFilter = (name, value) => setFilters((old) => ({ ...old, [name]: value, page: 1 }));
  const result = useApi(
    () => salaryOfferReport({ ...filters, pageSize: PAGE_SIZE }),
    [
      filters.positionId,
      filters.sourceId,
      filters.offerStatus,
      filters.from,
      filters.to,
      filters.page,
    ],
  );

  return (
    <>
      <Notice tone="warning" title="Restricted">
        This report shows salaries. Opening it and exporting it are recorded in the audit log.
      </Notice>
      <FilterBar label="Salary and offer filters">
        <FilterSelect
          label="Position"
          value={filters.positionId}
          onChange={(value) => setFilter('positionId', value)}
          options={toOptions(lookups?.positions)}
        />
        <FilterSelect
          label="Source"
          value={filters.sourceId}
          onChange={(value) => setFilter('sourceId', value)}
          options={toOptions(lookups?.sources)}
        />
        <FilterSelect
          label="Offer status"
          value={filters.offerStatus}
          onChange={(value) => setFilter('offerStatus', value)}
          options={OFFER_STATUS_OPTIONS}
        />
        <FormField
          label="Offer date from"
          type="date"
          value={filters.from}
          onChange={(event) => setFilter('from', event.target.value)}
        />
        <FormField
          label="Offer date to"
          type="date"
          value={filters.to}
          onChange={(event) => setFilter('to', event.target.value)}
        />
      </FilterBar>
      <ExportButtons
        report="salary-offers"
        filters={{
          positionId: filters.positionId,
          sourceId: filters.sourceId,
          offerStatus: filters.offerStatus,
          from: filters.from,
          to: filters.to,
        }}
      />
      <ReportState result={result}>
        {(data) => (
          <>
            <DataTable
              caption="Offered salary by position and offer status"
              columns={[
                { key: 'position', label: 'Position' },
                { key: 'status', label: 'Offer status' },
                { key: 'offers', label: 'Offers' },
                { key: 'priced', label: 'With salary' },
                { key: 'lowest', label: 'Lowest (LKR)' },
                { key: 'average', label: 'Average (LKR)' },
                { key: 'highest', label: 'Highest (LKR)' },
              ]}
              rows={data.groups.map((group) => ({
                id: `${group.position}-${group.offerStatus ?? 'none'}`,
                position: group.position,
                status: OFFER_STATUS_LABELS[group.offerStatus] ?? 'Not sent yet',
                offers: group.offers,
                priced: group.priced,
                lowest: lkr(group.lowest),
                average: lkr(group.average),
                highest: lkr(group.highest),
              }))}
              emptyTitle="No offers match"
              emptyMessage="No offer matches the chosen filters."
            />
            <DataTable
              caption="Offers"
              columns={[
                { key: 'candidate', label: 'Candidate' },
                { key: 'position', label: 'Position' },
                { key: 'status', label: 'Offer status' },
                { key: 'offerDate', label: 'Offer date' },
                { key: 'salary', label: 'Offered salary (LKR)' },
              ]}
              rows={data.items.map((row) => ({
                id: row.id,
                candidate: `${row.fullName} (${row.candidateCode})`,
                position: row.position,
                status: OFFER_STATUS_LABELS[row.offerStatus] ?? 'Not sent yet',
                offerDate: row.offerDate ? formatDate(row.offerDate) : '--',
                salary: row.salaryLkr === null ? 'Not set' : lkr(row.salaryLkr),
              }))}
              emptyTitle="No offers match"
              emptyMessage="No offer matches the chosen filters."
            />
            <Pagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              onPageChange={(page) => setFilters((old) => ({ ...old, page }))}
            />
          </>
        )}
      </ReportState>
    </>
  );
}

const PHASE_LABELS = {
  evaluation: 'Evaluation',
  probation: 'Probation',
  junior: 'Junior',
  senior: 'Senior',
};
const STATUS_LABELS = {
  active: 'Active',
  discontinued: 'Discontinued',
  terminated: 'Terminated',
};

export default function ReportsPage({ page }) {
  const { user } = useAuth();
  const [tab, setTab] = useState('status');
  const showSalary = Boolean(user?.permissions?.includes('salary.view'));
  const tabs = showSalary ? [...TABS, SALARY_TAB] : TABS;
  const lookups = useApi(loadCandidateLookups, []);
  const lists = lookups.status === 'ready' ? lookups.data : null;

  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      <div className="filter-bar" role="tablist" aria-label="Reports">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`button${tab === key ? '' : ' button--secondary'}`}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <section className="panel">
        {tab === 'status' && <CandidateStatusReport lookups={lists} />}
        {tab === 'funnel' && <FunnelReport />}
        {tab === 'salary' && showSalary && <SalaryOfferReport lookups={lists} />}
        {tab === 'sources' && (
          <BreakdownReport
            load={sourceReport}
            caption="Source report"
            nameLabel="Source"
            report="sources"
          />
        )}
        {tab === 'positions' && (
          <BreakdownReport
            load={positionReport}
            caption="Position report"
            nameLabel="Position"
            report="positions"
          />
        )}
        {tab === 'weekly' && <WeeklyReport />}
        {tab === 'onboarding' && (
          <RangeListReport
            load={onboardingReport}
            report="onboarding"
            caption="Onboarding report"
            rangeLabels={['Joined from', 'Joined to']}
            columns={[
              { key: 'employee', label: 'Employee' },
              { key: 'position', label: 'Position' },
              { key: 'joinDate', label: 'Join date' },
              { key: 'phase', label: 'Current phase' },
              { key: 'status', label: 'Status' },
            ]}
            mapRow={(row) => ({
              id: row.id,
              employee: `${row.fullName} (${row.candidateCode})`,
              position: row.position ?? '--',
              joinDate: formatDate(row.joinDate),
              phase: PHASE_LABELS[row.currentPhase] ?? row.currentPhase,
              status: STATUS_LABELS[row.status] ?? row.status,
            })}
            empty={{
              title: 'No employees joined',
              message: 'No employee joined in the chosen period.',
            }}
          />
        )}
        {tab === 'exit' && (
          <RangeListReport
            load={exitReport}
            report="exit"
            caption="Exit report"
            rangeLabels={['Exit from', 'Exit to']}
            columns={[
              { key: 'employee', label: 'Employee' },
              { key: 'position', label: 'Position' },
              { key: 'joinDate', label: 'Join date' },
              { key: 'status', label: 'Outcome' },
              { key: 'exitDate', label: 'Exit date' },
              { key: 'exitReason', label: 'Reason' },
            ]}
            mapRow={(row) => ({
              id: row.id,
              employee: `${row.fullName} (${row.candidateCode})`,
              position: row.position ?? '--',
              joinDate: formatDate(row.joinDate),
              status: STATUS_LABELS[row.status] ?? row.status,
              exitDate: formatDate(row.exitDate),
              exitReason: row.exitReason ?? '--',
            })}
            empty={{
              title: 'No exits',
              message: 'No employee was discontinued or terminated in the chosen period.',
            }}
          />
        )}
      </section>
    </>
  );
}

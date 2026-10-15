import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '../api/client.js';
import DataTable from '../components/DataTable.jsx';
import ErrorState from '../components/ErrorState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
import { formatDate, formatDateTime } from '../utils/format.js';

// Every figure comes from GET /api/dashboard/summary, which reads the
// database. Nothing is hardcoded: zero means the query returned zero.

const RECRUITMENT_CARDS = [
  ['totalCandidates', 'Total Candidates'],
  ['phoneScreened', 'Phone Screened'],
  ['interviewsScheduled', 'Interviews Scheduled'],
  ['interviewed', 'Interviewed'],
  ['selected', 'Selected'],
  ['rejected', 'Rejected'],
  ['onHold', 'On Hold'],
  ['offersSent', 'Offers Sent'],
  ['offersAccepted', 'Offers Accepted'],
  ['joined', 'Joined'],
];

const PHASE_CARDS = [
  ['evaluation', 'Evaluation'],
  ['probation', 'Probation'],
  ['junior', 'Junior'],
  ['senior', 'Senior'],
];

const EMPLOYMENT_CARDS = [
  ['currentlyWorking', 'Currently Working'],
  ['discontinued', 'Discontinued'],
  ['terminated', 'Terminated'],
];

const INTERVIEW_COLUMNS = [
  { key: 'candidate', label: 'Candidate' },
  { key: 'position', label: 'Position' },
  { key: 'scheduledAt', label: 'Date and time' },
  { key: 'interviewer', label: 'Interviewer' },
  { key: 'stage', label: 'Stage' },
];

const DEADLINE_COLUMNS = [
  { key: 'employee', label: 'Employee' },
  { key: 'position', label: 'Position' },
  { key: 'phase', label: 'Phase' },
  { key: 'endDate', label: 'End date' },
  { key: 'daysRemaining', label: 'Days remaining' },
];

const PHASE_LABELS = {
  evaluation: 'Evaluation',
  probation: 'Probation',
  junior: 'Junior',
  senior: 'Senior',
};

export default function DashboardPage({ page }) {
  const [state, setState] = useState({ status: 'loading', data: null });

  const load = useCallback(async () => {
    setState({ status: 'loading', data: null });
    try {
      const res = await apiGet('/dashboard/summary');
      if (res.ok) {
        setState({ status: 'ready', data: res.body });
      } else {
        setState({ status: 'error', data: null });
      }
    } catch {
      // The request itself failed (for example the network dropped): the
      // same error state as a failed answer, never an unhandled rejection.
      setState({ status: 'error', data: null });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const data = state.data;
  const interviewRows = (data?.upcomingInterviews ?? []).map((row) => ({
    id: row.id,
    candidate: `${row.candidateName} (${row.candidateCode})`,
    position: row.position ?? '--',
    scheduledAt: formatDateTime(row.scheduledAt),
    interviewer: row.interviewer ?? '--',
    stage: row.stage ?? '--',
  }));
  const deadlineRows = (data?.upcomingDeadlines ?? []).map((row) => ({
    id: row.id,
    employee: `${row.employeeName} (${row.candidateCode})`,
    position: row.position ?? '--',
    phase: PHASE_LABELS[row.phase] ?? row.phase,
    endDate: formatDate(row.endDate),
    daysRemaining: row.daysRemaining === 0 ? 'Today' : `${row.daysRemaining} day(s)`,
  }));

  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      {state.status === 'loading' && <LoadingState message="Loading dashboard…" />}

      {state.status === 'error' && (
        <ErrorState
          title="The dashboard could not be loaded"
          message="The figures could not be read from the server."
          onRetry={load}
        />
      )}

      {state.status === 'ready' && (
        <>
          <section aria-labelledby="recruitment-title">
            <h2 id="recruitment-title" className="section-title">
              Recruitment Summary
            </h2>
            <div className="stat-grid">
              {RECRUITMENT_CARDS.map(([key, label]) => (
                <StatCard key={key} label={label} value={data.counts[key]} />
              ))}
            </div>
          </section>

          <section aria-labelledby="lifecycle-title">
            <h2 id="lifecycle-title" className="section-title">
              Employee Lifecycle
            </h2>
            <div className="stat-grid">
              {PHASE_CARDS.map(([key, label]) => (
                <StatCard key={key} label={label} value={data.employeePhases[key]} />
              ))}
              {EMPLOYMENT_CARDS.map(([key, label]) => (
                <StatCard key={key} label={label} value={data.counts[key]} />
              ))}
            </div>
          </section>

          <div className="panel-grid">
            <section className="panel" aria-labelledby="upcoming-interviews">
              <h2 id="upcoming-interviews" className="panel__title">
                Upcoming Interviews
              </h2>
              <DataTable
                caption="Upcoming interviews"
                columns={INTERVIEW_COLUMNS}
                rows={interviewRows}
                emptyTitle="No upcoming interviews"
                emptyMessage="No direct interview is scheduled for a future date."
              />
            </section>

            <section className="panel" aria-labelledby="upcoming-deadlines">
              <h2 id="upcoming-deadlines" className="panel__title">
                Upcoming Deadlines (next 7 days)
              </h2>
              <DataTable
                caption="Upcoming employee deadlines"
                columns={DEADLINE_COLUMNS}
                rows={deadlineRows}
                emptyTitle="No deadlines in the next 7 days"
                emptyMessage="No active employee has a phase ending within 7 days. A junior phase with no stored end date is not shown."
              />
            </section>
          </div>
        </>
      )}
    </>
  );
}

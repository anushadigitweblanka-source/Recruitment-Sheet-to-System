import DataTable from '../components/DataTable.jsx';
import EmptyState from '../components/EmptyState.jsx';
import Notice from '../components/Notice.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatCard from '../components/StatCard.jsx';
import StatusBadge from '../components/StatusBadge.jsx';

// No figures are shown until they can be read from the database.
// Each card will receive a `value` once its query exists.
const METRICS = [
  'Candidates',
  'Phone Interviews',
  'Direct Interviews',
  'Selected',
  'Rejected',
  'On Hold',
  'Offers',
  'Joined Employees',
  'Active Employees',
  'Upcoming Reviews',
];

const INTERVIEW_COLUMNS = [
  { key: 'candidate', label: 'Candidate' },
  { key: 'position', label: 'Position' },
  { key: 'scheduledAt', label: 'Date and time' },
  { key: 'interviewer', label: 'Interviewer' },
];

const DEADLINE_COLUMNS = [
  { key: 'employee', label: 'Employee' },
  { key: 'phase', label: 'Phase' },
  { key: 'endDate', label: 'End date' },
  { key: 'teamLead', label: 'Team lead' },
];

const NOT_CONNECTED = 'This will be filled from the database once the feature is built.';

export default function DashboardPage({ page }) {
  return (
    <>
      <PageHeader
        title={page.label}
        description={page.description}
        actions={<StatusBadge tone="warning">Not connected to data yet</StatusBadge>}
      />

      <Notice>
        Dashboard figures are not connected to the database yet. Every value shows “--” until its
        query is built. No sample numbers are used.
      </Notice>

      <section aria-labelledby="metrics-title">
        <h2 id="metrics-title" className="section-title">
          Overview
        </h2>
        <div className="stat-grid">
          {METRICS.map((label) => (
            <StatCard key={label} label={label} />
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
            emptyTitle="Not available yet"
            emptyMessage={NOT_CONNECTED}
          />
        </section>

        <section className="panel" aria-labelledby="review-deadlines">
          <h2 id="review-deadlines" className="panel__title">
            Employee Review Deadlines
          </h2>
          <DataTable
            caption="Employee review deadlines"
            columns={DEADLINE_COLUMNS}
            emptyTitle="Not available yet"
            emptyMessage={NOT_CONNECTED}
          />
        </section>
      </div>

      <section className="panel" aria-labelledby="recent-activity">
        <h2 id="recent-activity" className="panel__title">
          Recent Recruitment Activity
        </h2>
        <EmptyState title="Not available yet" message={NOT_CONNECTED} />
      </section>
    </>
  );
}

import DataTable from '../../components/DataTable.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { NOTIFICATION_COLUMNS } from './fields.js';

export default function NotificationsPage({ page }) {
  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      <Notice tone="info" title="Sending rule (from the task guide)">
        A reminder is sent when its Send At time has passed and it has not been sent yet:{' '}
        <code>send_at &lt;= current time AND sent_at IS NULL</code>. Due At is the deadline itself;
        Send At is 24 hours before it. No emails are sent from this application yet.
      </Notice>

      <section className="panel">
        <DataTable
          caption="Notifications"
          columns={NOTIFICATION_COLUMNS}
          emptyTitle="Feature not connected yet"
          emptyMessage="Scheduled reminders will be listed here once the feature is built."
        />
      </section>
    </>
  );
}

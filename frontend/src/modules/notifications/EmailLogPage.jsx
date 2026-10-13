import DataTable from '../../components/DataTable.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { EMAIL_LOG_COLUMNS } from './fields.js';

export default function EmailLogPage({ page }) {
  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      <Notice tone="info">
        The same template is never sent twice to the same candidate unless it is explicitly resent.
        A resend is shown in the Resend column. No emails are sent from this application yet.
      </Notice>

      <section className="panel">
        <DataTable
          caption="Email log"
          columns={EMAIL_LOG_COLUMNS}
          emptyTitle="Feature not connected yet"
          emptyMessage="Sent and failed mails will be listed here once the feature is built."
        />
      </section>
    </>
  );
}

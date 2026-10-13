import DataTable from '../../components/DataTable.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { EMAIL_TEMPLATE_COLUMNS } from './fields.js';

export default function EmailTemplatesPage({ page }) {
  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      <section className="panel">
        <DataTable
          caption="Email templates"
          columns={EMAIL_TEMPLATE_COLUMNS}
          emptyTitle="Feature not connected yet"
          emptyMessage="Templates will be listed here once the feature is built."
        />
      </section>
    </>
  );
}

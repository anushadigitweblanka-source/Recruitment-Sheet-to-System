import { Link, useParams } from 'react-router';
import DataTable from '../../components/DataTable.jsx';
import DetailList from '../../components/DetailList.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { DOCUMENT_COLUMNS } from './fields.js';

const CV_FIELDS = [
  { name: 'cvUrl', label: 'CV Link' },
  { name: 'companyCvUrl', label: 'Company CV Link' },
  { name: 'companyCvStatus', label: 'Company CV Status' },
];

export default function CandidateDocumentsPage({ page }) {
  const { id } = useParams();

  return (
    <>
      <PageHeader
        title={page.label}
        description={page.description}
        actions={
          <>
            <Link to={`/candidates/${id}`} className="button">
              Back to candidate
            </Link>
            <button type="button" className="button button--primary" disabled>
              Upload document
            </button>
          </>
        }
      />

      <Notice title="MENTOR CONFIRMATION REQUIRED">
        Where uploaded files are stored has not been decided, so uploading is switched off.
      </Notice>

      <section className="panel">
        <DetailList fields={CV_FIELDS} />
      </section>

      <section className="panel">
        <DataTable
          caption="Candidate documents"
          columns={DOCUMENT_COLUMNS}
          emptyTitle="Feature not connected yet"
          emptyMessage="Uploaded documents will be listed here once the feature is built."
        />
      </section>
    </>
  );
}

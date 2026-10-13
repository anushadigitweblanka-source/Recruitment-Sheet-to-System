import { Link, useParams } from 'react-router';
import DetailList from '../../components/DetailList.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { getCandidate } from './api.js';
import { toDisplayValues } from './CandidateDetailsPage.jsx';

const CV_FIELDS = [
  { name: 'candidateCode', label: 'Candidate ID' },
  { name: 'fullName', label: 'Name' },
  { name: 'cvUrl', label: 'CV Link' },
  { name: 'companyCvUrl', label: 'Company CV Link' },
  { name: 'companyCvStatus', label: 'Company CV Status' },
];

// Shows the two CV links held on the candidate. Uploading files is not built:
// where uploaded files are stored has not been approved.
export default function CandidateDocumentsPage({ page }) {
  const { id } = useParams();
  const result = useApi(() => getCandidate(id), [id]);
  const candidate = result.status === 'ready' ? result.data.candidate : null;

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
        CV storage method pending approval. Uploading is switched off until it is decided where
        uploaded files are kept. The CV links below can be changed on the Edit Candidate page.
      </Notice>

      {result.status === 'error' && (
        <ErrorState title="The candidate could not be loaded" onRetry={result.reload} />
      )}

      <section className="panel">
        {result.status === 'loading' && <LoadingState message="Loading candidate…" />}
        {result.status === 'not-found' && (
          <EmptyState
            title="Candidate not found"
            message="There is no candidate at this address."
          />
        )}
        {candidate && <DetailList fields={CV_FIELDS} values={toDisplayValues(candidate)} />}
      </section>
    </>
  );
}

import { Link, useLocation, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthContext.jsx';
import DetailList from '../../components/DetailList.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { useApi } from '../../hooks/useApi.js';
import CandidateEmailPanel from '../notifications/CandidateEmailPanel.jsx';
import CandidateMessagePanel from '../notifications/CandidateMessagePanel.jsx';
import { formatDateTime } from '../../utils/format.js';
import { getCandidate } from './api.js';
import { CANDIDATE_DETAIL_FIELDS, COMPANY_CV_STATUS_LABELS } from './fields.js';

// Links open in a new tab and tell the other site nothing about this one.
function ExternalLink({ href }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="detail-list__link">
      {href}
    </a>
  );
}

const by = (name) => (name ? ` by ${name}` : '');

// Turns the API's candidate into what each detail row shows. Anything empty
// is left out, so the row shows "--".
export function toDisplayValues(candidate) {
  return {
    candidateCode: candidate.candidateCode,
    fullName: candidate.fullName,
    stage: <StatusBadge tone="info">{candidate.stage.name}</StatusBadge>,
    phone: candidate.phone,
    email: candidate.email,
    address: candidate.address,
    olMaths: candidate.olMaths,
    alResult: candidate.alResult,
    alStream: candidate.alStream,
    otherEducation: candidate.otherEducation,
    position: candidate.position?.name,
    source: candidate.source?.name,
    cvUrl: candidate.cvUrl && <ExternalLink href={candidate.cvUrl} />,
    companyCvUrl: candidate.companyCvUrl && <ExternalLink href={candidate.companyCvUrl} />,
    companyCvStatus: COMPANY_CV_STATUS_LABELS[candidate.companyCvStatus],
    hrComment: candidate.hrComment,
    created: `${formatDateTime(candidate.createdAt)}${by(candidate.createdBy)}`,
    updated: `${formatDateTime(candidate.updatedAt)}${by(candidate.updatedBy)}`,
  };
}

export default function CandidateDetailsPage({ page }) {
  const { id } = useParams();
  const location = useLocation();
  const { user } = useAuth();
  const canEdit = (user?.permissions ?? []).includes('candidates.edit');
  const result = useApi(() => getCandidate(id), [id]);
  const candidate = result.status === 'ready' ? result.data.candidate : null;

  return (
    <>
      <PageHeader
        title={page.label}
        description={page.description}
        actions={
          candidate && (
            <>
              <Link to={`/candidates/${id}/documents`} className="button">
                CV / Documents
              </Link>
              {canEdit && (
                <Link to={`/candidates/${id}/edit`} className="button button--primary">
                  Edit Candidate
                </Link>
              )}
            </>
          )
        }
      />

      {location.state?.saved && (
        <Notice tone="success" role="status">
          {location.state.saved}
        </Notice>
      )}

      {result.status === 'error' && (
        <ErrorState title="The candidate could not be loaded" onRetry={result.reload} />
      )}
      {result.status === 'forbidden' && (
        <ErrorState title="You do not have permission to view candidates" />
      )}

      <section className="panel">
        {result.status === 'loading' && <LoadingState message="Loading candidate…" />}
        {result.status === 'not-found' && (
          <EmptyState
            title="Candidate not found"
            message="There is no candidate at this address."
          />
        )}
        {candidate && (
          <DetailList fields={CANDIDATE_DETAIL_FIELDS} values={toDisplayValues(candidate)} />
        )}
      </section>

      {candidate && <CandidateEmailPanel candidateId={candidate.id} />}
      {candidate && <CandidateMessagePanel candidateId={candidate.id} />}

      <p className="back-link">
        <Link to="/candidates">Back to the candidate list</Link>
      </p>
    </>
  );
}

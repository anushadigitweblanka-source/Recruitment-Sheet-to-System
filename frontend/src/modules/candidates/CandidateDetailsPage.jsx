import { Link, useParams } from 'react-router';
import RecordDetails from '../../components/RecordDetails.jsx';
import { CANDIDATE_DETAIL_FIELDS } from './fields.js';

export default function CandidateDetailsPage({ page }) {
  const { id } = useParams();

  return (
    <RecordDetails
      page={page}
      fields={CANDIDATE_DETAIL_FIELDS}
      actions={
        <>
          <Link to={`/candidates/${id}/documents`} className="button">
            CV / Documents
          </Link>
          <Link to={`/candidates/${id}/edit`} className="button button--primary">
            Edit Candidate
          </Link>
        </>
      }
    />
  );
}

import { Link, useParams } from 'react-router';
import RecordDetails from '../../components/RecordDetails.jsx';
import { INTERVIEW_DETAIL_FIELDS } from './fields.js';

export default function InterviewDetailsPage({ page }) {
  const { id } = useParams();

  return (
    <RecordDetails
      page={page}
      fields={INTERVIEW_DETAIL_FIELDS}
      actions={
        <Link to={`/interviews/${id}/evaluate`} className="button button--primary">
          Evaluate interview
        </Link>
      }
    />
  );
}

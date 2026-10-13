import { Link, useParams } from 'react-router';
import RecordDetails from '../../components/RecordDetails.jsx';
import { PHONE_INTERVIEW_FIELDS } from './fields.js';

export default function PhoneInterviewDetailsPage({ page }) {
  const { id } = useParams();

  return (
    <RecordDetails
      page={page}
      fields={PHONE_INTERVIEW_FIELDS}
      actions={
        <Link to={`/phone-interviews/${id}/edit`} className="button button--primary">
          Record phone interview
        </Link>
      }
    />
  );
}

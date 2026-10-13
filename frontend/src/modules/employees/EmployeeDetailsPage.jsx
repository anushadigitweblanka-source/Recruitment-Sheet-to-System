import { Link, useParams } from 'react-router';
import RecordDetails from '../../components/RecordDetails.jsx';
import { EMPLOYEE_FIELDS } from './fields.js';

export default function EmployeeDetailsPage({ page }) {
  const { id } = useParams();

  return (
    <RecordDetails
      page={page}
      fields={EMPLOYEE_FIELDS}
      actions={
        <Link to={`/employees/${id}/lifecycle`} className="button button--primary">
          Lifecycle Timeline
        </Link>
      }
    />
  );
}

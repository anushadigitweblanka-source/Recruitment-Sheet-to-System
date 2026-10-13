import { Link } from 'react-router';
import PageHeader from '../components/PageHeader.jsx';

export default function NotFoundPage() {
  return (
    <>
      <PageHeader title="Page not found" description="There is no page at this address." />
      <p>
        <Link to="/dashboard">Go to the dashboard</Link>
      </p>
    </>
  );
}

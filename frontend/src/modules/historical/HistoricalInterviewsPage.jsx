import PageHeader from '../../components/PageHeader.jsx';
import HistoricalRecordsPanel from './HistoricalRecordsPanel.jsx';

export default function HistoricalInterviewsPage({ page }) {
  return (
    <>
      <PageHeader title={page.label} description={page.description} />
      <HistoricalRecordsPanel />
    </>
  );
}

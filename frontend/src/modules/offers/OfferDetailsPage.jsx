import RecordDetails from '../../components/RecordDetails.jsx';
import { OFFER_FIELDS } from './fields.js';
import SalaryPendingNotice from './SalaryPendingNotice.jsx';

export default function OfferDetailsPage({ page }) {
  return (
    <RecordDetails page={page} fields={OFFER_FIELDS}>
      <SalaryPendingNotice />
    </RecordDetails>
  );
}

import { FormGrid } from '../../components/FormField.jsx';
import FormPanel from '../../components/FormPanel.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { OFFER_FIELDS } from './fields.js';
import SalaryPendingNotice from './SalaryPendingNotice.jsx';

export default function OfferFormPage({ page }) {
  return (
    <>
      <PageHeader title={page.label} description={page.description} />
      <Notice>Feature not connected yet. Nothing typed here is saved.</Notice>
      <SalaryPendingNotice />
      <FormPanel cancelTo="/offers">
        <FormGrid fields={OFFER_FIELDS} />
      </FormPanel>
    </>
  );
}

import { useParams } from 'react-router';
import { FormGrid } from '../../components/FormField.jsx';
import FormPanel from '../../components/FormPanel.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { PHONE_INTERVIEW_FIELDS } from './fields.js';

export default function PhoneInterviewFormPage({ page }) {
  const { id } = useParams();

  return (
    <>
      <PageHeader title={page.label} description={page.description} />
      <Notice>Feature not connected yet. Nothing typed here is saved.</Notice>
      <FormPanel cancelTo={`/phone-interviews/${id}`}>
        <FormGrid fields={PHONE_INTERVIEW_FIELDS} />
      </FormPanel>
    </>
  );
}

import { useParams } from 'react-router';
import { FormGrid } from '../../components/FormField.jsx';
import FormPanel from '../../components/FormPanel.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { CANDIDATE_FIELDS } from './fields.js';

// Used for both Add Candidate and Edit Candidate.
export default function CandidateFormPage({ page }) {
  const { id } = useParams();
  const isEdit = Boolean(id);

  return (
    <>
      <PageHeader title={page.label} description={page.description} />
      <Notice>
        Feature not connected yet. Nothing typed here is saved
        {isEdit && ', and the existing candidate cannot be loaded'}.
      </Notice>
      <FormPanel cancelTo={isEdit ? `/candidates/${id}` : '/candidates'}>
        <FormGrid fields={CANDIDATE_FIELDS} />
      </FormPanel>
    </>
  );
}

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAuth } from '../../auth/AuthContext.jsx';
import { loadCandidateLookups } from '../../api/lookups.js';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import { FormGrid } from '../../components/FormField.jsx';
import FormPanel from '../../components/FormPanel.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { createCandidate, getCandidate, updateCandidate } from './api.js';
import DuplicateWarning from './DuplicateWarning.jsx';
import { CANDIDATE_FIELDS } from './fields.js';

const EMPTY_VALUES = Object.fromEntries(CANDIDATE_FIELDS.map((field) => [field.name, '']));
const NO_CANDIDATE = async () => ({ ok: true, status: 200, body: null });

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_SHAPE = /^\+?[0-9]{9,15}$/;
const URL_SHAPE = /^https?:\/\/\S+$/i;

// Quick checks for the user's convenience. The backend checks everything
// again and has the final say.
function validate(values) {
  const errors = {};
  if (!values.candidateCode.trim()) errors.candidateCode = 'Candidate ID is required.';
  if (!values.fullName.trim()) errors.fullName = 'Name is required.';

  const phone = values.phone.replace(/[\s\-().]/g, '');
  if (phone && !PHONE_SHAPE.test(phone)) {
    errors.phone = 'Phone must be 9 to 15 digits, with an optional + at the start.';
  }
  if (values.email.trim() && !EMAIL_SHAPE.test(values.email.trim())) {
    errors.email = 'Email is not a valid address.';
  }
  for (const [name, label] of [
    ['cvUrl', 'CV Link'],
    ['companyCvUrl', 'Company CV Link'],
  ]) {
    if (values[name].trim() && !URL_SHAPE.test(values[name].trim())) {
      errors[name] = `${label} must be a web address starting with http:// or https://.`;
    }
  }
  return errors;
}

function toFormValues(candidate) {
  const values = { ...EMPTY_VALUES };
  for (const { name } of CANDIDATE_FIELDS) {
    const value = candidate[name];
    values[name] = value === null || value === undefined ? '' : String(value);
  }
  return values;
}

function toPayload(values) {
  return {
    ...values,
    positionId: values.positionId ? Number(values.positionId) : null,
    sourceId: values.sourceId ? Number(values.sourceId) : null,
  };
}

// Active values, plus the candidate's current value even if it has since been
// switched off, so an old record still shows what it holds.
function lookupOptions(items, currentId) {
  return items
    .filter((item) => item.isActive || String(item.id) === currentId)
    .map((item) => ({
      value: String(item.id),
      label: item.isActive ? item.name : `${item.name} (no longer in use)`,
    }));
}

// Used for both Add Candidate and Edit Candidate.
export default function CandidateFormPage({ page }) {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const mayEdit = (user?.permissions ?? []).includes('candidates.edit');

  const lookups = useApi(loadCandidateLookups, []);
  const existing = useApi(() => (isEdit ? getCandidate(id) : NO_CANDIDATE()), [id]);

  const [values, setValues] = useState(EMPTY_VALUES);
  const [errors, setErrors] = useState({});
  const [duplicates, setDuplicates] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // When editing, fill the form once the candidate has arrived.
  useEffect(() => {
    if (existing.status === 'ready' && existing.data) {
      setValues(toFormValues(existing.data.candidate));
    }
  }, [existing.status, existing.data]);

  function handleChange(name, value) {
    setValues((old) => ({ ...old, [name]: value }));
    setErrors((old) => ({ ...old, [name]: undefined }));
    // Any edit after a duplicate warning means it must be checked again.
    setDuplicates(null);
  }

  async function save({ confirmDuplicate = false } = {}) {
    const problems = validate(values);
    setErrors(problems);
    setSaveError(null);
    if (Object.keys(problems).length > 0) return;

    setSaving(true);
    let res;
    try {
      const payload = { ...toPayload(values), confirmDuplicate };
      res = await (isEdit ? updateCandidate(id, payload) : createCandidate(payload));
    } catch {
      res = null;
    }
    setSaving(false);

    if (res?.ok) {
      navigate(`/candidates/${res.body.candidate.id}`, {
        state: { saved: isEdit ? 'Changes saved.' : 'Candidate added.' },
      });
    } else if (res?.status === 409) {
      setDuplicates(res.body.duplicates);
    } else if (res?.status === 422) {
      setDuplicates(null);
      setErrors(res.body.fields ?? {});
      setSaveError('Some fields need correcting. Nothing was saved.');
    } else if (res?.status === 403) {
      setSaveError('You do not have permission to save candidates.');
    } else {
      setSaveError('The candidate could not be saved. Check your connection and try again.');
    }
  }

  const header = <PageHeader title={page.label} description={page.description} />;

  // The server refuses the save too; this only spares the user a form they
  // cannot use.
  if (!mayEdit) {
    return (
      <>
        {header}
        <ErrorState
          title="You do not have permission to add or edit candidates"
          message="Ask an administrator if you need access."
        />
      </>
    );
  }

  if (existing.status === 'loading' || lookups.status === 'loading') {
    return (
      <>
        {header}
        <section className="panel">
          <LoadingState />
        </section>
      </>
    );
  }
  if (existing.status === 'not-found') {
    return (
      <>
        {header}
        <section className="panel">
          <EmptyState
            title="Candidate not found"
            message="There is no candidate at this address."
          />
        </section>
      </>
    );
  }
  if (existing.status !== 'ready') {
    return (
      <>
        {header}
        <ErrorState title="The candidate could not be loaded" onRetry={existing.reload} />
      </>
    );
  }

  const lists = lookups.status === 'ready' ? lookups.data : { positions: [], sources: [] };
  const noValuesHint = (what) =>
    `No ${what} have been defined yet. An administrator can add them under Administration → Positions & Sources.`;
  const fields = CANDIDATE_FIELDS.map((field) => {
    if (field.name === 'positionId') {
      const options = lookupOptions(lists.positions, values.positionId);
      return {
        ...field,
        options,
        hint: options.length === 0 ? noValuesHint('positions') : undefined,
      };
    }
    if (field.name === 'sourceId') {
      const options = lookupOptions(lists.sources, values.sourceId);
      return {
        ...field,
        options,
        hint: options.length === 0 ? noValuesHint('sources') : undefined,
      };
    }
    return field;
  });

  return (
    <>
      {header}

      {lookups.status !== 'ready' && (
        <Notice>
          The position and source lists could not be loaded, so those two fields are empty.
        </Notice>
      )}
      {saveError && (
        <Notice tone="danger" role="alert">
          {saveError}
        </Notice>
      )}
      {duplicates && (
        <DuplicateWarning
          duplicates={duplicates}
          saving={saving}
          onConfirm={() => save({ confirmDuplicate: true })}
          onCancel={() => setDuplicates(null)}
        />
      )}

      <FormPanel
        cancelTo={isEdit ? `/candidates/${id}` : '/candidates'}
        onSubmit={() => save()}
        saving={saving}
      >
        <FormGrid
          fields={fields}
          values={values}
          errors={errors}
          onChange={handleChange}
          disabled={saving}
        />
      </FormPanel>
    </>
  );
}

import { useState } from 'react';
import DataTable from '../../components/DataTable.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import FormField from '../../components/FormField.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { useApi } from '../../hooks/useApi.js';
import { createTemplate, listTemplates, updateTemplate } from './api.js';
import { EMAIL_TEMPLATE_COLUMNS, SEND_MODE_OPTIONS } from './fields.js';

const EMPTY_VALUES = { type: '', subject: '', body: '', sendMode: 'review', isActive: true };

const shorten = (text, max = 80) => (text.length > max ? `${text.slice(0, max)}…` : text);

// One form for a new template and for changing an existing one. The wording
// of a template is the company's to write: nothing is pre-filled.
function TemplateForm({ editing, onSaved, onCancel }) {
  const isNew = !editing;
  const [values, setValues] = useState(
    isNew
      ? EMPTY_VALUES
      : {
          type: editing.type,
          subject: editing.subject,
          body: editing.body,
          sendMode: editing.sendMode,
          isActive: editing.isActive,
        },
  );
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const set = (name, value) => {
    setValues((old) => ({ ...old, [name]: value }));
    setErrors((old) => ({ ...old, [name]: undefined }));
  };
  const field = (name) => ({
    name,
    value: values[name],
    onChange: (event) => set(name, event.target.value),
    disabled: saving,
    error: errors[name],
  });

  async function handleSubmit(event) {
    event.preventDefault();
    setSaveError(null);

    const problems = {};
    if (!values.type.trim()) problems.type = 'Template Type is required.';
    if (!values.subject.trim()) problems.subject = 'Subject is required.';
    if (!values.body.trim()) problems.body = 'Body is required.';
    setErrors(problems);
    if (Object.keys(problems).length > 0) return;

    setSaving(true);
    let res;
    try {
      res = await (isNew ? createTemplate(values) : updateTemplate(editing.id, values));
    } catch {
      res = null;
    }
    setSaving(false);

    if (res?.ok) onSaved();
    else if (res?.status === 422) {
      setErrors(res.body.fields ?? {});
      setSaveError('Some fields need correcting. Nothing was saved.');
    } else if (res?.status === 403) {
      setSaveError('Only an administrator can manage templates.');
    } else {
      setSaveError('The template could not be saved. Try again.');
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <h2 className="panel__title">{isNew ? 'New template' : `Edit template: ${editing.type}`}</h2>
      {saveError && (
        <Notice tone="danger" role="alert">
          {saveError}
        </Notice>
      )}
      <div className="form-grid">
        <FormField
          label="Template Type"
          required
          maxLength={50}
          hint="A code like interview_invitation: lower-case letters, digits and underscores."
          {...field('type')}
        />
        <FormField
          label="Subject"
          required
          maxLength={200}
          hint="May use {name} and {candidate_code}."
          {...field('subject')}
        />
        <FormField label="Body" type="textarea" required wide rows={6} {...field('body')} />
        <FormField
          label="Send Mode"
          type="select"
          options={SEND_MODE_OPTIONS}
          hint="How this template behaves once manual sending exists."
          {...field('sendMode')}
        />
        <FormField
          label="Active"
          type="checkbox"
          name="isActive"
          checked={values.isActive}
          onChange={(event) => set('isActive', event.target.checked)}
          disabled={saving}
          hint="An inactive template is kept but never sent."
        />
      </div>
      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save template'}
        </button>
        <button type="button" className="button" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export default function EmailTemplatesPage({ page }) {
  const list = useApi(() => listTemplates(), []);
  // null = closed, 'new' = creating, or the template being edited.
  const [editing, setEditing] = useState(null);
  const [saved, setSaved] = useState(false);

  const rows =
    list.status === 'ready'
      ? list.data.items.map((template) => ({
          id: template.id,
          type: template.type,
          subject: shorten(template.subject),
          body: shorten(template.body),
          active: template.isActive ? (
            <StatusBadge tone="success">Active</StatusBadge>
          ) : (
            <StatusBadge>Inactive</StatusBadge>
          ),
          actions: (
            <span className="table-actions">
              <button
                type="button"
                className="button-link"
                onClick={() => {
                  setSaved(false);
                  setEditing(template);
                }}
              >
                Edit
              </button>
            </span>
          ),
        }))
      : [];

  return (
    <>
      <PageHeader
        title={page.label}
        description={page.description}
        actions={
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              setSaved(false);
              setEditing('new');
            }}
          >
            New template
          </button>
        }
      />

      {saved && (
        <Notice tone="success" role="status">
          Template saved.
        </Notice>
      )}

      {editing && (
        <section className="panel">
          <TemplateForm
            editing={editing === 'new' ? null : editing}
            onSaved={() => {
              setEditing(null);
              setSaved(true);
              list.reload();
            }}
            onCancel={() => setEditing(null)}
          />
        </section>
      )}

      <section className="panel">
        {list.status === 'loading' && <LoadingState message="Loading templates…" />}
        {list.status === 'forbidden' && (
          <ErrorState title="You do not have permission to view templates" />
        )}
        {list.status === 'error' && (
          <ErrorState title="The templates could not be loaded" onRetry={list.reload} />
        )}
        {list.status === 'ready' && (
          <DataTable
            caption="Email templates"
            columns={EMAIL_TEMPLATE_COLUMNS}
            rows={rows}
            emptyTitle="No templates yet"
            emptyMessage="Add the mail templates the company approves. No wording is created automatically."
          />
        )}
      </section>
    </>
  );
}

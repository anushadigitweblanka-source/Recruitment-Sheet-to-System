import { useEffect, useState } from 'react';
import { getSalary, saveSalary } from '../../api/stage11.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import FormField from '../../components/FormField.jsx';
import Notice from '../../components/Notice.jsx';

// Salary on an offer's details page. Only the Main User holds salary.view and
// salary.edit; the server enforces it and logs every view and change. For
// anyone else this shows only that salary is not visible to them - it never
// asks the server for it.
export default function SalaryPanel({ candidateId }) {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  if (!permissions.includes('salary.view')) {
    return (
      <Notice tone="info" title="Salary is not shown here">
        Salary is visible and editable by the Main User only. Every view and change is logged.
      </Notice>
    );
  }
  return <SalaryEditor candidateId={candidateId} canEdit={permissions.includes('salary.edit')} />;
}

function SalaryEditor({ candidateId, canEdit }) {
  const [state, setState] = useState({ status: 'loading', salary: null });
  const [value, setValue] = useState('');
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSalary(candidateId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) {
          setState({ status: 'ready', salary: res.body.salary });
          setValue(res.body.salary ? String(res.body.salary.salaryLkr) : '');
        } else {
          setState({ status: 'error', salary: null });
        }
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', salary: null });
      });
    return () => {
      cancelled = true;
    };
  }, [candidateId]);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await saveSalary(candidateId, value.trim()).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      setState({ status: 'ready', salary: res.body.salary });
      setSaved(true);
    } else if (res?.status === 422) {
      setError(res.body.fields?.salaryLkr ?? 'The amount is not valid.');
    } else if (res?.status === 403) {
      setError('Only the Main User can change salary.');
    } else {
      setError('The salary could not be saved. Try again.');
    }
  }

  return (
    <section className="panel" aria-labelledby="salary-title">
      <h2 id="salary-title" className="panel__title">
        Salary (Main User only)
      </h2>
      {state.status === 'loading' && <p>Loading salary…</p>}
      {state.status === 'error' && (
        <Notice tone="danger" role="alert">
          The salary could not be loaded.
        </Notice>
      )}
      {state.status === 'ready' && (
        <>
          <p className="field__hint">
            Viewing and changing salary is recorded in the audit log. It appears in no report,
            export or mail.
          </p>
          <FormField
            label="Salary (LKR)"
            type="number"
            min="0"
            step="0.01"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setSaved(false);
            }}
            disabled={!canEdit || saving}
            error={error}
          />
          {canEdit && (
            <div className="form-actions">
              <button
                type="button"
                className="button button--primary"
                disabled={saving || value.trim() === ''}
                onClick={save}
              >
                {saving ? 'Saving…' : 'Save salary'}
              </button>
            </div>
          )}
          {saved && (
            <Notice tone="success" role="status">
              Salary saved.
            </Notice>
          )}
        </>
      )}
    </section>
  );
}

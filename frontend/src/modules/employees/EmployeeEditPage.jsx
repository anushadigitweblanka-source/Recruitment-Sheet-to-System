import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import FormField from '../../components/FormField.jsx';
import FormPanel from '../../components/FormPanel.jsx';
import LoadingState from '../../components/LoadingState.jsx';
import Notice from '../../components/Notice.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import { useApi } from '../../hooks/useApi.js';
import { getEmployee, updateEmployee } from './api.js';
import { TRACK_OPTIONS } from './fields.js';

// Only the track is edited here. The join date comes from the offer, and the
// phases change only through gate decisions.
export default function EmployeeEditPage({ page }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const loaded = useApi(() => getEmployee(id), [id]);
  const [track, setTrack] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (loaded.status === 'ready') setTrack(loaded.data.employee.track ?? '');
  }, [loaded.status, loaded.data]);

  async function save() {
    setSaving(true);
    setError(null);
    let res;
    try {
      res = await updateEmployee(id, { track: track || null });
    } catch {
      res = null;
    }
    setSaving(false);
    if (res?.ok) {
      navigate(`/employees/${id}`, { state: { saved: 'Track saved.' } });
    } else if (res?.status === 403) {
      setError('You do not have permission to manage employees.');
    } else if (res?.status === 422) {
      setError(res.body.fields?.track ?? 'Some fields need correcting.');
    } else {
      setError('The track could not be saved. Check your connection and try again.');
    }
  }

  const header = <PageHeader title={page.label} description={page.description} />;
  if (loaded.status === 'loading') {
    return (
      <>
        {header}
        <section className="panel">
          <LoadingState />
        </section>
      </>
    );
  }
  if (loaded.status === 'not-found') {
    return (
      <>
        {header}
        <section className="panel">
          <EmptyState title="Employee not found" message="There is no employee at this address." />
        </section>
      </>
    );
  }
  if (loaded.status !== 'ready') {
    return (
      <>
        {header}
        <ErrorState title="The employee could not be loaded" onRetry={loaded.reload} />
      </>
    );
  }

  return (
    <>
      {header}
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      <FormPanel cancelTo={`/employees/${id}`} onSubmit={save} saving={saving}>
        <div className="form-grid">
          <FormField label="Employee" value={loaded.data.candidate.fullName} readOnly />
          <FormField
            label="Track"
            type="select"
            name="track"
            options={TRACK_OPTIONS}
            value={track}
            onChange={(event) => setTrack(event.target.value)}
            disabled={saving}
            hint="Intern or Staff. The task guide does not say where this comes from, so HR sets it."
          />
        </div>
      </FormPanel>
    </>
  );
}

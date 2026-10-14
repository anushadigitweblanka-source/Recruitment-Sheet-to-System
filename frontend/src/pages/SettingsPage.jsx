import { useState } from 'react';
import { listSettings, updateSetting } from '../api/admin.js';
import ErrorState from '../components/ErrorState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import Notice from '../components/Notice.jsx';
import PageHeader from '../components/PageHeader.jsx';
import { useApi } from '../hooks/useApi.js';
import { formatDateTime } from '../utils/format.js';

// The labels for the settings that exist today (the phase durations from the
// task guide). An unknown key still renders, with its key as the label, so a
// future setting appears without a frontend change.
const LABELS = {
  evaluation_days: 'Evaluation length (days)',
  probation_months: 'Probation length (months)',
  probation_max_extension_months: 'Probation maximum extension (months)',
  junior_months: 'Junior stage length (months)',
};

function SettingRow({ setting, onSaved }) {
  const [value, setValue] = useState(setting.value);
  const [state, setState] = useState({ status: 'idle', message: null });

  const changed = value.trim() !== setting.value;

  async function save() {
    setState({ status: 'saving', message: null });
    const res = await updateSetting(setting.key, value.trim());
    if (res.ok) {
      setState({ status: 'saved', message: 'Saved.' });
      onSaved(res.body.setting);
    } else if (res.status === 422) {
      setState({
        status: 'invalid',
        message: res.body?.fields?.value ?? 'The value is not valid.',
      });
    } else if (res.status === 403) {
      setState({ status: 'error', message: 'Only an administrator can change settings.' });
    } else {
      setState({ status: 'error', message: 'The setting could not be saved. Try again.' });
    }
  }

  return (
    <div className="panel">
      <div className="field">
        <label htmlFor={`setting-${setting.key}`} className="field__label">
          {LABELS[setting.key] ?? setting.key}
        </label>
        {setting.description && <p className="field__hint">{setting.description}</p>}
        <input
          id={`setting-${setting.key}`}
          className="field__control"
          type="number"
          min="1"
          max="365"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setState({ status: 'idle', message: null });
          }}
        />
      </div>
      <button
        type="button"
        className="button button--primary"
        disabled={state.status === 'saving' || !changed}
        onClick={save}
      >
        {state.status === 'saving' ? 'Saving…' : 'Save'}
      </button>
      {state.message && (
        <Notice tone={state.status === 'saved' ? 'success' : 'danger'} role="alert">
          {state.message}
        </Notice>
      )}
      <p className="field__hint">Last changed: {formatDateTime(setting.updatedAt) ?? '--'}</p>
    </div>
  );
}

export default function SettingsPage({ page }) {
  const result = useApi(listSettings, []);
  const [saved, setSaved] = useState({});

  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      <Notice tone="info" title="Where these values are used">
        The phase durations are read at every lifecycle gate decision, so a change takes effect on
        the next decision. The junior end date stays uncalculated until the 9-month rule is
        confirmed by the mentor. Every change is written to the audit log.
      </Notice>

      {result.status === 'loading' && <LoadingState message="Loading settings…" />}
      {result.status === 'forbidden' && (
        <ErrorState
          title="Administrators only"
          message="Only an administrator can view and change settings."
        />
      )}
      {result.status === 'error' && (
        <ErrorState
          title="Settings could not be loaded"
          message="The settings could not be read from the server."
          onRetry={result.reload}
        />
      )}
      {result.status === 'ready' &&
        result.data.items.map((setting) => (
          <SettingRow
            key={setting.key}
            setting={saved[setting.key] ?? setting}
            onSaved={(next) => setSaved((old) => ({ ...old, [next.key]: next }))}
          />
        ))}
    </>
  );
}

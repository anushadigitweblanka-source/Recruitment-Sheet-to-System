import { useId, useState } from 'react';
import { addLookup, listLookup } from '../api/lookups.js';
import EmptyState from '../components/EmptyState.jsx';
import ErrorState from '../components/ErrorState.jsx';
import LoadingState from '../components/LoadingState.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useApi } from '../hooks/useApi.js';

// One closed list (positions or sources): what it holds, and a box to add to it.
function LookupList({ list, title, singular }) {
  const result = useApi(() => listLookup(list), [list]);
  const [name, setName] = useState('');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);
  const inputId = useId();
  const errorId = useId();
  const headingId = useId();

  async function handleSubmit(event) {
    event.preventDefault();
    if (!name.trim()) {
      setError(`Enter a ${singular} name.`);
      return;
    }

    setSaving(true);
    setError(null);
    let res;
    try {
      res = await addLookup(list, name);
    } catch {
      res = null;
    }
    setSaving(false);

    if (res?.ok) {
      setName('');
      result.reload();
    } else if (res?.status === 422) {
      setError(res.body.message);
    } else if (res?.status === 403) {
      setError('Only an administrator can add values.');
    } else {
      setError('The value could not be saved. Try again.');
    }
  }

  const items = result.status === 'ready' ? result.data.items : [];

  return (
    <section className="panel" aria-labelledby={headingId}>
      <h2 id={headingId} className="panel__title">
        {title}
      </h2>

      {result.status === 'loading' && <LoadingState />}
      {result.status === 'error' && (
        <ErrorState title={`${title} could not be loaded`} onRetry={result.reload} />
      )}
      {result.status === 'ready' && items.length === 0 && (
        <EmptyState
          title={`No ${title.toLowerCase()} yet`}
          message="Add the approved values below. None are created automatically."
        />
      )}
      {items.length > 0 && (
        <ul className="lookup-list">
          {items.map((item) => (
            <li key={item.id}>
              {item.name}
              {!item.isActive && <StatusBadge>No longer in use</StatusBadge>}
            </li>
          ))}
        </ul>
      )}

      <form className="lookup-form" onSubmit={handleSubmit} noValidate>
        <div className={`field field--search${error ? ' field--invalid' : ''}`}>
          <label htmlFor={inputId} className="field__label">
            New {singular}
          </label>
          <input
            id={inputId}
            className="field__control"
            value={name}
            maxLength={100}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            disabled={saving}
          />
          {error && (
            <p id={errorId} className="field__error" role="alert">
              {error}
            </p>
          )}
        </div>
        <button type="submit" className="button button--primary" disabled={saving}>
          {saving ? 'Adding…' : `Add ${singular}`}
        </button>
      </form>
    </section>
  );
}

export default function LookupsPage({ page }) {
  return (
    <>
      <PageHeader title={page.label} description={page.description} />
      <div className="panel-grid">
        <LookupList list="positions" title="Positions" singular="position" />
        <LookupList list="sources" title="Sources" singular="source" />
      </div>
    </>
  );
}

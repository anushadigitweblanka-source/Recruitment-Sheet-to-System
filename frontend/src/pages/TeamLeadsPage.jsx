import { useState } from 'react';
import { listUsers } from '../api/admin.js';
import { listLookup } from '../api/lookups.js';
import { createTeamLead, listTeamLeads, updateTeamLead } from '../api/stage11.js';
import DataTable from '../components/DataTable.jsx';
import ErrorState from '../components/ErrorState.jsx';
import FormField from '../components/FormField.jsx';
import LoadingState from '../components/LoadingState.jsx';
import Notice from '../components/Notice.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useApi } from '../hooks/useApi.js';

const COLUMNS = [
  { key: 'position', label: 'Position / Team' },
  { key: 'name', label: 'Team Lead' },
  { key: 'email', label: 'Email' },
  { key: 'login', label: 'Linked login' },
  { key: 'active', label: 'Status' },
  { key: 'actions', label: 'Actions' },
];

const EMPTY = { positionId: '', teamName: '', name: '', email: '', userId: '' };

// The Team Lead mapping from the task guide: which Team Lead belongs to which
// position. The system picks the Team Lead from the candidate's applied
// position; a linked login limits that user to their own team's candidates.
export default function TeamLeadsPage({ page }) {
  const leads = useApi(listTeamLeads, []);
  const positions = useApi(() => listLookup('positions'), []);
  const users = useApi(listUsers, []);
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  const positionOptions =
    positions.status === 'ready'
      ? positions.data.items.filter((p) => p.isActive).map((p) => ({ value: p.id, label: p.name }))
      : [];
  const userOptions =
    users.status === 'ready'
      ? users.data.items
          .filter((u) => u.isActive)
          .map((u) => ({ value: u.id, label: `${u.fullName} (${u.email})` }))
      : [];
  const userName = (id) => userOptions.find((o) => o.value === id)?.label ?? `User ${id}`;

  const set = (name) => ({
    name,
    value: values[name],
    onChange: (event) => {
      setValues((old) => ({ ...old, [name]: event.target.value }));
      setErrors((old) => ({ ...old, [name]: undefined }));
    },
    disabled: busy,
    error: errors[name],
  });

  async function add(event) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await createTeamLead({
      positionId: values.positionId ? Number(values.positionId) : null,
      teamName: values.teamName,
      name: values.name,
      email: values.email,
      userId: values.userId ? Number(values.userId) : null,
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setValues(EMPTY);
      setErrors({});
      setMessage({ tone: 'success', text: 'Team Lead saved.' });
      leads.reload();
    } else if (res?.status === 422) {
      setErrors(res.body.fields ?? {});
      setMessage({ tone: 'danger', text: 'Some fields need correcting. Nothing was saved.' });
    } else if (res?.status === 403) {
      setMessage({ tone: 'danger', text: 'Only the Main User can manage Team Leads.' });
    } else {
      setMessage({ tone: 'danger', text: 'The Team Lead could not be saved. Try again.' });
    }
  }

  async function toggle(lead) {
    setBusy(true);
    const res = await updateTeamLead(lead.id, { isActive: !lead.isActive }).catch(() => null);
    setBusy(false);
    if (res?.ok) leads.reload();
    else setMessage({ tone: 'danger', text: 'The change could not be saved. Try again.' });
  }

  const rows =
    leads.status === 'ready'
      ? leads.data.items.map((lead) => ({
          id: lead.id,
          position: lead.teamName ? `${lead.position.name} (${lead.teamName})` : lead.position.name,
          name: lead.name,
          email: lead.email,
          login: lead.userId ? userName(lead.userId) : 'None',
          active: lead.isActive ? (
            <StatusBadge tone="success">Active</StatusBadge>
          ) : (
            <StatusBadge>Inactive</StatusBadge>
          ),
          actions: (
            <button
              type="button"
              className="button-link"
              disabled={busy}
              onClick={() => toggle(lead)}
            >
              {lead.isActive ? 'Deactivate' : 'Activate'}
            </button>
          ),
        }))
      : [];

  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      <Notice tone="info" title="How this is used">
        Each position has one Team Lead. Interview invitations, the Team Lead summary and interview
        reminders go to the Team Lead of the candidate&apos;s applied position. Linking a login
        limits that user to their own team&apos;s candidates and scores.
      </Notice>

      {message && (
        <Notice tone={message.tone} role="alert">
          {message.text}
        </Notice>
      )}

      <section className="panel">
        <h2 className="panel__title">Add a Team Lead</h2>
        <form onSubmit={add} noValidate>
          <div className="form-grid">
            <FormField
              label="Position"
              type="select"
              required
              options={positionOptions}
              {...set('positionId')}
            />
            <FormField label="Team name (optional)" maxLength={100} {...set('teamName')} />
            <FormField label="Team Lead name" required maxLength={150} {...set('name')} />
            <FormField label="Team Lead email" type="email" required {...set('email')} />
            <FormField
              label="Linked login (optional)"
              type="select"
              options={userOptions}
              hint="The user who signs in as this Team Lead."
              {...set('userId')}
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="button button--primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save Team Lead'}
            </button>
          </div>
        </form>
      </section>

      <section className="panel">
        {leads.status === 'loading' && <LoadingState message="Loading Team Leads…" />}
        {leads.status === 'forbidden' && (
          <ErrorState
            title="Administrators only"
            message="Only the Main User can manage Team Leads."
          />
        )}
        {leads.status === 'error' && (
          <ErrorState title="Team Leads could not be loaded" onRetry={leads.reload} />
        )}
        {leads.status === 'ready' && (
          <DataTable
            caption="Team Leads"
            columns={COLUMNS}
            rows={rows}
            emptyTitle="No Team Leads yet"
            emptyMessage="Add the Team Lead for each position. Nothing is created automatically."
          />
        )}
      </section>
    </>
  );
}

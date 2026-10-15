import { useState } from 'react';
import {
  createUser,
  listRoles,
  listUsers,
  resetUserPassword,
  setUserStatus,
} from '../api/admin.js';
import DataTable from '../components/DataTable.jsx';
import ErrorState from '../components/ErrorState.jsx';
import FormField from '../components/FormField.jsx';
import LoadingState from '../components/LoadingState.jsx';
import Notice from '../components/Notice.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useApi } from '../hooks/useApi.js';
import { formatDateTime } from '../utils/format.js';

// Users administration on the existing identity schema. Users are never
// deleted (the audit log references them): leaving is deactivation. No
// password is ever shown after save, and none is kept in state longer than
// the request that uses it.

const COLUMNS = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'role', label: 'Role' },
  { key: 'status', label: 'Status' },
  { key: 'lastLogin', label: 'Last sign-in' },
  { key: 'actions', label: 'Actions' },
];

function CreateUserForm({ roles, onCreated }) {
  const empty = {
    fullName: '',
    email: '',
    roleId: roles[0] ? String(roles[0].id) : '',
    password: '',
  };
  const [values, setValues] = useState(empty);
  const [fields, setFields] = useState({});
  const [state, setState] = useState('idle');
  const set = (name) => (event) => {
    setValues((old) => ({ ...old, [name]: event.target.value }));
    setFields((old) => ({ ...old, [name]: undefined }));
  };

  async function submit(event) {
    event.preventDefault();
    setState('saving');
    const res = await createUser({ ...values, roleId: Number(values.roleId) });
    if (res.ok) {
      setValues(empty); // the password leaves the state immediately
      setFields({});
      setState('saved');
      onCreated(res.body.user);
    } else if (res.status === 422) {
      setFields(res.body?.fields ?? {});
      setState('invalid');
    } else {
      setState('error');
    }
  }

  return (
    <form className="panel" onSubmit={submit} aria-label="Create user">
      <h2 className="panel__title">Create User</h2>
      <FormField
        label="Name"
        value={values.fullName}
        onChange={set('fullName')}
        error={fields.fullName}
      />
      <FormField
        label="Email"
        type="email"
        value={values.email}
        onChange={set('email')}
        error={fields.email}
      />
      <div className="field">
        <label htmlFor="new-user-role" className="field__label">
          Role
        </label>
        <select
          id="new-user-role"
          className="field__control"
          value={values.roleId}
          onChange={set('roleId')}
        >
          {roles.map((role) => (
            <option key={role.id} value={String(role.id)}>
              {role.name}
            </option>
          ))}
        </select>
        {fields.roleId && <p className="field__error">{fields.roleId}</p>}
      </div>
      <FormField
        label="Password (at least 12 characters)"
        type="password"
        value={values.password}
        onChange={set('password')}
        error={fields.password}
      />
      <button type="submit" className="button button--primary" disabled={state === 'saving'}>
        {state === 'saving' ? 'Creating…' : 'Create User'}
      </button>
      {state === 'saved' && (
        <Notice tone="success" role="alert">
          The user was created. The password is not shown again.
        </Notice>
      )}
      {state === 'error' && (
        <Notice tone="danger" role="alert">
          The user could not be created. Try again.
        </Notice>
      )}
    </form>
  );
}

function ResetPasswordForm({ user, onDone, onCancel }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState(null);
  const [saving, setSaving] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (password !== confirm) {
      setMessage('The two passwords do not match.');
      return;
    }
    setSaving(true);
    const res = await resetUserPassword(user.id, password);
    setPassword('');
    setConfirm('');
    setSaving(false);
    if (res.ok) {
      onDone();
    } else {
      setMessage(res.body?.fields?.password ?? 'The password could not be reset. Try again.');
    }
  }

  return (
    <form className="panel" onSubmit={submit} aria-label={`Reset password for ${user.fullName}`}>
      <h2 className="panel__title">Reset password – {user.fullName}</h2>
      <FormField
        label="New password (at least 12 characters)"
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
      />
      <FormField
        label="Confirm new password"
        type="password"
        value={confirm}
        onChange={(event) => setConfirm(event.target.value)}
      />
      {message && (
        <Notice tone="danger" role="alert">
          {message}
        </Notice>
      )}
      <button type="submit" className="button button--primary" disabled={saving}>
        {saving ? 'Resetting…' : 'Reset password'}
      </button>{' '}
      <button type="button" className="button button--secondary" onClick={onCancel}>
        Cancel
      </button>
    </form>
  );
}

export default function UsersPage({ page }) {
  const users = useApi(listUsers, []);
  const roles = useApi(listRoles, []);
  const [overrides, setOverrides] = useState({});
  const [created, setCreated] = useState([]);
  const [resetting, setResetting] = useState(null);
  const [message, setMessage] = useState(null);

  const applyUser = (user) => setOverrides((old) => ({ ...old, [user.id]: user }));

  async function toggleStatus(user) {
    const verb = user.isActive ? 'Deactivate' : 'Reactivate';
    if (!window.confirm(`${verb} ${user.fullName}? They will be signed out everywhere.`)) return;
    const res = await setUserStatus(user.id, !user.isActive);
    if (res.ok) {
      applyUser(res.body.user);
      setMessage({
        tone: 'success',
        text: `${user.fullName} is now ${res.body.user.isActive ? 'active' : 'deactivated'}.`,
      });
    } else {
      setMessage({
        tone: 'danger',
        text: res.body?.fields?.isActive ?? 'The status could not be changed. Try again.',
      });
    }
  }

  const list =
    users.status === 'ready'
      ? [
          ...users.data.items,
          ...created.filter((u) => !users.data.items.some((e) => e.id === u.id)),
        ].map((user) => overrides[user.id] ?? user)
      : [];
  const roleItems = roles.status === 'ready' ? roles.data.items : [];

  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      <Notice tone="info" title="Roles">
        Only the roles that exist in the database can be assigned. The final role list (HR, Team
        Lead, Intern) is still waiting for the mentor&apos;s confirmation, so new roles are not
        invented here. Users are never deleted; deactivation keeps the audit history intact.
      </Notice>

      {message && (
        <Notice tone={message.tone} role="alert">
          {message.text}
        </Notice>
      )}

      {(users.status === 'loading' || roles.status === 'loading') && (
        <LoadingState message="Loading users…" />
      )}
      {users.status === 'forbidden' && (
        <ErrorState title="Administrators only" message="Only an administrator can manage users." />
      )}
      {users.status === 'error' && (
        <ErrorState
          title="Users could not be loaded"
          message="The user list could not be read from the server."
          onRetry={users.reload}
        />
      )}

      {users.status === 'ready' && roles.status === 'ready' && (
        <>
          <section className="panel">
            <DataTable
              caption="Users"
              columns={COLUMNS}
              rows={list.map((user) => ({
                id: user.id,
                name: user.fullName,
                email: user.email,
                role: user.role.name,
                status: (
                  <StatusBadge tone={user.isActive ? 'success' : 'warning'}>
                    {user.isActive ? 'Active' : 'Deactivated'}
                  </StatusBadge>
                ),
                lastLogin: formatDateTime(user.lastLoginAt) ?? '--',
                actions: (
                  <>
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => toggleStatus(user)}
                    >
                      {user.isActive ? 'Deactivate' : 'Reactivate'}
                    </button>{' '}
                    <button
                      type="button"
                      className="button button--secondary"
                      onClick={() => setResetting(user)}
                    >
                      Reset password
                    </button>
                  </>
                ),
              }))}
              emptyTitle="No users"
              emptyMessage="No user accounts exist yet."
            />
          </section>

          {resetting && (
            <ResetPasswordForm
              user={resetting}
              onCancel={() => setResetting(null)}
              onDone={() => {
                setResetting(null);
                setMessage({
                  tone: 'success',
                  text: 'The password was reset. It is not shown again.',
                });
              }}
            />
          )}

          <CreateUserForm
            roles={roleItems}
            onCreated={(user) => setCreated((old) => [...old, user])}
          />
        </>
      )}
    </>
  );
}

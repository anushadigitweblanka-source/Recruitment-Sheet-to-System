import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  clearAccountPassword,
  listCompanyAccounts,
  markAccountCreated,
  markAccountDisabled,
  markAccountHandedOver,
  resetAccountPassword,
  revealAccountPassword,
  setAccountPassword,
} from '../api/stage11.js';
import { useAuth } from '../auth/AuthContext.jsx';
import DataTable from '../components/DataTable.jsx';
import ErrorState from '../components/ErrorState.jsx';
import FormField from '../components/FormField.jsx';
import LoadingState from '../components/LoadingState.jsx';
import Notice from '../components/Notice.jsx';
import PageHeader from '../components/PageHeader.jsx';
import StatusBadge from '../components/StatusBadge.jsx';
import { useApi } from '../hooks/useApi.js';
import { formatDate } from '../utils/format.js';

const COLUMNS = [
  { key: 'candidate', label: 'Employee' },
  { key: 'status', label: 'Status' },
  { key: 'companyEmail', label: 'Company email' },
  { key: 'dates', label: 'Created / Handed over' },
  { key: 'actions', label: 'Actions' },
];

const STATUS = {
  requested: { label: 'Requested', tone: 'warning' },
  created: { label: 'Created', tone: 'info' },
  handed_over: { label: 'Handed over', tone: 'success' },
  disabled: { label: 'Disabled', tone: 'neutral' },
};

// How long a revealed password stays on screen, as the guide says.
const REVEAL_SECONDS = 30;

// The company account lifecycle: Requested -> Created (IT) -> Handed over
// (HR) -> Disabled when the employee leaves. The temporary password is
// masked; only the Main User can reveal it, and only after re-entering their
// own login password. It disappears from the screen after 30 seconds.
function PasswordTools({ account, onChanged }) {
  const [loginPassword, setLoginPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [shown, setShown] = useState(null);
  const [message, setMessage] = useState(null);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  function showFor30Seconds(password) {
    setShown(password);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShown(null), REVEAL_SECONDS * 1000);
  }

  async function run(action, onOk) {
    setMessage(null);
    const res = await action().catch(() => null);
    if (res?.ok) {
      onOk?.(res.body);
      onChanged();
    } else if (res?.status === 422) {
      setMessage(Object.values(res.body.fields ?? {}).join(' '));
    } else if (res?.status === 503) {
      setMessage('Passwords are not available: the encryption key is not configured.');
    } else if (res?.status === 403) {
      setMessage('Only the Main User can use temporary passwords.');
    } else {
      setMessage('That could not be done. Try again.');
    }
  }

  return (
    <div className="panel">
      <p>
        <strong>Temporary password:</strong>{' '}
        {shown ? <code>{shown}</code> : account.hasStoredPassword ? '••••••••••••' : 'None stored'}
      </p>
      {shown && (
        <p className="field__hint">Shown for {REVEAL_SECONDS} seconds, then hidden again.</p>
      )}
      {message && (
        <Notice tone="danger" role="alert">
          {message}
        </Notice>
      )}
      <FormField
        label="Temporary password to keep"
        type="password"
        autoComplete="off"
        value={newPassword}
        onChange={(event) => setNewPassword(event.target.value)}
      />
      <div className="form-actions">
        <button
          type="button"
          className="button"
          disabled={!newPassword}
          onClick={() =>
            run(
              () => setAccountPassword(account.id, newPassword),
              () => setNewPassword(''),
            )
          }
        >
          Save password
        </button>
        <button
          type="button"
          className="button"
          onClick={() =>
            run(
              () => resetAccountPassword(account.id),
              (b) => showFor30Seconds(b.password),
            )
          }
        >
          Reset (new random password)
        </button>
        <button
          type="button"
          className="button"
          disabled={!account.hasStoredPassword}
          onClick={() =>
            run(
              () => clearAccountPassword(account.id),
              () => setShown(null),
            )
          }
        >
          Employee changed it: delete
        </button>
      </div>
      <FormField
        label="Your own login password (to reveal)"
        type="password"
        autoComplete="current-password"
        value={loginPassword}
        onChange={(event) => setLoginPassword(event.target.value)}
      />
      <div className="form-actions">
        <button
          type="button"
          className="button button--primary"
          disabled={!account.hasStoredPassword || !loginPassword}
          onClick={() =>
            run(
              () => revealAccountPassword(account.id, loginPassword),
              (b) => {
                setLoginPassword('');
                showFor30Seconds(b.password);
              },
            )
          }
        >
          Reveal for 30 seconds
        </button>
      </div>
    </div>
  );
}

function AccountRow({ account, canUsePassword, onChanged }) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState(null);
  const [open, setOpen] = useState(false);

  async function act(action) {
    setMessage(null);
    const res = await action().catch(() => null);
    if (res?.ok) onChanged();
    else if (res?.status === 422) setMessage(Object.values(res.body.fields ?? {}).join(' '));
    else setMessage('That could not be done. Try again.');
  }

  const info = STATUS[account.status];
  return (
    <>
      <div className="panel">
        <h2 className="panel__title">
          <Link to={`/candidates/${account.candidate.id}`}>{account.candidate.fullName}</Link>{' '}
          <StatusBadge tone={info.tone}>{info.label}</StatusBadge>
          {account.disablePending && <StatusBadge tone="warning">Disable pending</StatusBadge>}
        </h2>
        <p>
          Company email: {account.companyEmail ?? '--'} · Created:{' '}
          {formatDate(account.createdDate) ?? '--'} · Handed over:{' '}
          {formatDate(account.handedOverDate) ?? '--'}
        </p>
        {message && (
          <Notice tone="danger" role="alert">
            {message}
          </Notice>
        )}
        <div className="form-actions">
          {account.status === 'requested' && (
            <>
              <FormField
                label="Company email (IT)"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button
                type="button"
                className="button button--primary"
                disabled={!email}
                onClick={() => act(() => markAccountCreated(account.id, { companyEmail: email }))}
              >
                Mark Created
              </button>
            </>
          )}
          {account.status === 'created' && (
            <button
              type="button"
              className="button button--primary"
              onClick={() => act(() => markAccountHandedOver(account.id, {}))}
            >
              Mark Handed over
            </button>
          )}
          {account.disablePending && (
            <button
              type="button"
              className="button"
              onClick={() => act(() => markAccountDisabled(account.id, {}))}
            >
              Mark Disabled (completed)
            </button>
          )}
          {canUsePassword && ['created', 'handed_over'].includes(account.status) && (
            <button type="button" className="button" onClick={() => setOpen((v) => !v)}>
              {open ? 'Hide password tools' : 'Password tools'}
            </button>
          )}
        </div>
      </div>
      {open && canUsePassword && <PasswordTools account={account} onChanged={onChanged} />}
    </>
  );
}

export default function CompanyAccountsPage({ page }) {
  const { user } = useAuth();
  const canUsePassword = user?.permissions?.includes('company_accounts.password');
  const result = useApi(() => listCompanyAccounts(), []);

  const accounts = result.status === 'ready' ? result.data.items : [];
  const rows = accounts.map((a) => ({
    id: a.id,
    candidate: a.candidate.fullName,
    status: STATUS[a.status].label,
    companyEmail: a.companyEmail ?? '--',
    dates: `${formatDate(a.createdDate) ?? '--'} / ${formatDate(a.handedOverDate) ?? '--'}`,
    actions: '',
  }));

  return (
    <>
      <PageHeader title={page.label} description={page.description} />

      <Notice tone="info" title="The flow">
        Attended = Yes requests an account. IT marks it Created with the company email, HR marks it
        Handed over. When the employee is discontinued or terminated a Disable action is recorded,
        and the account becomes Disabled once completed. Temporary passwords are never shown in a
        list.
      </Notice>

      {result.status === 'loading' && <LoadingState message="Loading company accounts…" />}
      {result.status === 'forbidden' && (
        <ErrorState title="You do not have permission to manage company accounts" />
      )}
      {result.status === 'error' && (
        <ErrorState title="Company accounts could not be loaded" onRetry={result.reload} />
      )}
      {result.status === 'ready' && (
        <>
          {accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              canUsePassword={canUsePassword}
              onChanged={result.reload}
            />
          ))}
          {accounts.length === 0 && (
            <DataTable
              caption="Company accounts"
              columns={COLUMNS}
              rows={rows}
              emptyTitle="No company accounts yet"
              emptyMessage="An account is requested automatically when an employee is marked Attended."
            />
          )}
        </>
      )}
    </>
  );
}

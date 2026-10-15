import { useState } from 'react';
import { useAuth } from '../../auth/AuthContext.jsx';
import Notice from '../../components/Notice.jsx';
import { useApi } from '../../hooks/useApi.js';
import { approveEmail, listApprovals, rejectEmail } from './api.js';

// Offer mails (the joining / onboarding mail) prepared by HR wait here for the
// Main User, who approves (it is sent) or rejects them. Everyone who may send
// mail sees the waiting list; only the Main User gets the buttons - and the
// server refuses anyone else regardless.
export default function EmailApprovalsPanel({ onChanged }) {
  const { user } = useAuth();
  const permissions = user?.permissions ?? [];
  const canSee = permissions.includes('notifications.manage');
  const canApprove = permissions.includes('admin.manage');
  const list = useApi(
    () => (canSee ? listApprovals() : Promise.resolve({ ok: true, body: { items: [] } })),
    [canSee],
  );
  const [message, setMessage] = useState(null);
  const [busy, setBusy] = useState(false);

  if (!canSee || list.status !== 'ready' || (list.data.items.length === 0 && !message)) return null;

  async function act(action, text) {
    setBusy(true);
    setMessage(null);
    const res = await action().catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setMessage({ tone: 'success', text });
      list.reload();
      onChanged?.();
    } else {
      setMessage({ tone: 'danger', text: 'That could not be done. Try again.' });
    }
  }

  return (
    <section className="panel" aria-labelledby="approvals-title">
      <h2 id="approvals-title" className="panel__title">
        Offer mails waiting for the Main User
      </h2>
      {message && (
        <Notice tone={message.tone} role="status">
          {message.text}
        </Notice>
      )}
      {list.data.items.map((item) => (
        <div key={item.id} className="panel">
          <p>
            <strong>{item.candidate.fullName}</strong> — to {item.to.join(', ')}
            {item.preparedBy ? ` — prepared by ${item.preparedBy}` : ''}
          </p>
          <p>
            <strong>{item.subject}</strong>
          </p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{item.body}</p>
          {canApprove ? (
            <div className="form-actions">
              <button
                type="button"
                className="button button--primary"
                disabled={busy}
                onClick={() => act(() => approveEmail(item.id), 'Approved and sent.')}
              >
                Approve and send
              </button>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => act(() => rejectEmail(item.id), 'Rejected.')}
              >
                Reject
              </button>
            </div>
          ) : (
            <p className="field__hint">Only the Main User can approve this mail.</p>
          )}
        </div>
      ))}
    </section>
  );
}

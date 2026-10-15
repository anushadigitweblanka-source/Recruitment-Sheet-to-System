import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import StatusBadge from '../../components/StatusBadge.jsx';
import { formatDateTime } from '../../utils/format.js';
import { listMyAlerts, markAlertRead, markAllAlertsRead } from './api.js';
import { NOTIFICATION_STATUS_TONES, typeLabel } from './fields.js';

// The in-app alert bell in the header: the signed-in user's own reminders
// (the same ones the scheduler emails, 24 hours before each deadline), with
// the number not yet read. The server decides which alerts are theirs and
// which ones may be opened; nothing here filters or guesses.
const REFRESH_MS = 60_000;

// The email's own status, in words for an alert.
const EMAIL_STATUS_LABELS = {
  pending: 'Email scheduled',
  sent: 'Email sent',
  failed: 'Email failed',
};

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState({ status: 'loading', data: null });
  const rootRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await listMyAlerts();
      setState(
        res.ok
          ? { status: 'ready', data: res.body }
          : { status: res.status === 401 ? 'signed-out' : 'error', data: null },
      );
    } catch {
      setState({ status: 'error', data: null });
    }
  }, []);

  // Loaded once, then refreshed now and then and whenever the list is opened.
  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    if (!open) return undefined;
    load();
    const onKey = (event) => event.key === 'Escape' && setOpen(false);
    const onClick = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open, load]);

  if (state.status === 'signed-out') return null;

  const items = state.data?.items ?? [];
  const unread = state.data?.unreadCount ?? 0;

  async function markOne(id) {
    // Shown as read at once; the server's answer replaces it on the next load.
    setState((old) =>
      old.data
        ? {
            ...old,
            data: {
              unreadCount: Math.max(0, old.data.unreadCount - 1),
              items: old.data.items.map((item) =>
                item.id === id && !item.read ? { ...item, read: true } : item,
              ),
            },
          }
        : old,
    );
    try {
      await markAlertRead(id);
    } catch {
      /* the next refresh shows the real state */
    }
  }

  async function markAll() {
    setState((old) =>
      old.data
        ? {
            ...old,
            data: {
              unreadCount: 0,
              items: old.data.items.map((item) => ({ ...item, read: true })),
            },
          }
        : old,
    );
    try {
      await markAllAlertsRead();
    } catch {
      /* the next refresh shows the real state */
    }
  }

  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <div className="bell" ref={rootRef}>
      <button
        type="button"
        className="bell__button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <span className="bell__icon" aria-hidden="true">
          &#128276;
        </span>
        {unread > 0 && (
          <span className="bell__badge" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="bell__panel" role="dialog" aria-label="Notifications">
          <div className="bell__head">
            <strong>Notifications</strong>
            {unread > 0 && (
              <button type="button" className="button-link" onClick={markAll}>
                Mark all as read
              </button>
            )}
          </div>

          {state.status === 'loading' && <p className="bell__note">Loading notifications…</p>}

          {state.status === 'error' && (
            <div className="bell__note" role="alert">
              <p>The notifications could not be loaded.</p>
              <button type="button" className="button" onClick={load}>
                Try again
              </button>
            </div>
          )}

          {state.status === 'ready' && items.length === 0 && (
            <p className="bell__note">You have no notifications.</p>
          )}

          {state.status === 'ready' && items.length > 0 && (
            <ul className="bell__list">
              {items.map((item) => (
                <li key={item.id} className={`bell__item${item.read ? '' : ' bell__item--unread'}`}>
                  <p className="bell__title">
                    {!item.read && <span className="sr-only">Unread. </span>}
                    {typeLabel(item.type)}
                  </p>
                  <p>
                    {item.candidate.candidateCode} — {item.candidate.fullName}
                  </p>
                  <p className="bell__meta">Deadline: {formatDateTime(item.dueAt)}</p>
                  <p className="bell__meta">
                    <StatusBadge tone={NOTIFICATION_STATUS_TONES[item.emailStatus]}>
                      {EMAIL_STATUS_LABELS[item.emailStatus] ?? item.emailStatus}
                    </StatusBadge>
                  </p>
                  <p className="bell__actions">
                    {item.link && (
                      <Link
                        to={item.link}
                        onClick={() => {
                          markOne(item.id);
                          setOpen(false);
                        }}
                      >
                        Open
                      </Link>
                    )}
                    {!item.read && (
                      <button
                        type="button"
                        className="button-link"
                        onClick={() => markOne(item.id)}
                      >
                        Mark as read
                      </button>
                    )}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

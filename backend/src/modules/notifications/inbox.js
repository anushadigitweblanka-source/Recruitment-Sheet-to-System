// The in-app alerts of one signed-in user: the reminders the scheduler creates
// (notifications), shown to the people they are addressed to, with a personal
// read mark (notification_reads, migration 014).
//
// Who an alert is for - the only rule, nothing is guessed:
//   - the user's login email is in the notification's recipients or
//     cc_recipients (compared without case), or
//   - the user is the login linked (team_leads.user_id) to an active Team Lead
//     whose address is in recipients or cc_recipients.
// The candidate's own address can match nobody, as candidates have no login.
//
// When an alert appears: from its send time (deadline minus 24 hours, set by
// the scheduler from the guide's rules) until it is cancelled, whatever the
// email did. The email status is shown with it and never changed here.
//
// What a row carries: the type, the candidate and employee it is about, the
// deadline, the email status, the read state and a link. It never carries the
// other recipients' addresses, and nothing here reads salary or credentials.

// Where an alert leads, and which permission opens that page. A user without
// any of the permissions gets no link.
const LINKS = {
  evaluation_end: { subject: 'employee', any: ['candidates.view'] },
  probation_end: { subject: 'employee', any: ['candidates.view'] },
  junior_end: { subject: 'employee', any: ['candidates.view'] },
  interview_reminder: { subject: 'interview', any: ['candidates.view', 'candidates.view_team'] },
  joining_reminder: { subject: 'offer', any: ['candidates.view'] },
  cv_pending: { subject: 'candidate', any: ['candidates.view', 'candidates.view_team'] },
};

const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

// $1 = user id, $2 = user email. Used by every query below.
const ADDRESSED_TO_USER = `
  n.status <> 'cancelled'
  AND n.send_at <= now()
  AND (
    lower($2) = ANY (SELECT lower(x) FROM unnest(n.recipients || n.cc_recipients) x)
    OR EXISTS (
      SELECT 1 FROM team_leads tl
       WHERE tl.user_id = $1 AND tl.is_active
         AND lower(tl.email) = ANY (SELECT lower(x) FROM unnest(n.recipients || n.cc_recipients) x)
    )
  )`;

const FROM_ALERTS = `
  FROM notifications n
  JOIN candidates c ON c.id = n.candidate_id
  LEFT JOIN phase_history ph ON ph.id = n.phase_history_id
  LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = $1`;

function linkFor(row, permissions) {
  const rule = LINKS[row.type];
  if (!rule || !rule.any.some((code) => permissions.includes(code))) return null;
  switch (rule.subject) {
    case 'employee':
      return row.employee_id ? `/employees/${row.employee_id}` : null;
    case 'interview':
      return row.interview_id ? `/interviews/${row.interview_id}` : null;
    case 'offer':
      return row.offer_id ? `/offers/${row.offer_id}` : null;
    default:
      return `/candidates/${row.candidate_id}`;
  }
}

const toAlert = (row, permissions) => ({
  id: Number(row.id),
  type: row.type,
  candidate: {
    id: Number(row.candidate_id),
    candidateCode: row.candidate_code,
    fullName: row.full_name,
  },
  dueAt: row.due_at,
  sendAt: row.send_at,
  // The email's own status: pending, sent or failed.
  emailStatus: row.status,
  read: row.read_at !== null,
  readAt: row.read_at,
  link: linkFor(row, permissions),
});

export function parseLimit(raw) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

export async function listAlerts(db, user, { limit = DEFAULT_LIMIT } = {}) {
  const params = [user.id, user.email];
  const unread = await db.query(
    `SELECT count(*)::int AS n ${FROM_ALERTS}
      WHERE ${ADDRESSED_TO_USER} AND r.notification_id IS NULL`,
    params,
  );
  const { rows } = await db.query(
    `SELECT n.id, n.type, n.status, n.due_at, n.send_at, n.interview_id, n.offer_id,
            ph.employee_id, c.id AS candidate_id, c.candidate_code, c.full_name, r.read_at
       ${FROM_ALERTS}
      WHERE ${ADDRESSED_TO_USER}
      ORDER BY (r.notification_id IS NULL) DESC, n.send_at DESC, n.id DESC
      LIMIT $3`,
    [...params, limit],
  );
  return {
    unreadCount: unread.rows[0].n,
    items: rows.map((row) => toAlert(row, user.permissions)),
  };
}

// Marks one alert read for this user. An alert that is not addressed to them is
// "not found", exactly as if it did not exist, so nothing about it leaks.
export async function markRead(db, user, notificationId) {
  const { rows } = await db.query(
    `INSERT INTO notification_reads (notification_id, user_id)
     SELECT n.id, $1 FROM notifications n
      WHERE n.id = $3 AND ${ADDRESSED_TO_USER}
     ON CONFLICT (notification_id, user_id) DO NOTHING
     RETURNING notification_id`,
    [user.id, user.email, notificationId],
  );
  if (rows.length > 0) return { ok: true };
  // Already read, or not addressed to this user: tell them apart.
  const visible = await db.query(
    `SELECT 1 FROM notifications n WHERE n.id = $3 AND ${ADDRESSED_TO_USER}`,
    [user.id, user.email, notificationId],
  );
  return visible.rows.length > 0 ? { ok: true } : { ok: false, reason: 'not_found' };
}

export async function markAllRead(db, user) {
  const { rows } = await db.query(
    `INSERT INTO notification_reads (notification_id, user_id)
     SELECT n.id, $1 FROM notifications n
      WHERE ${ADDRESSED_TO_USER}
     ON CONFLICT (notification_id, user_id) DO NOTHING
     RETURNING notification_id`,
    [user.id, user.email],
  );
  return { marked: rows.length };
}

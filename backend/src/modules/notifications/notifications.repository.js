// All SQL for Module 6. `db` is the pool, or a client inside a transaction.
// Nothing here reads or writes mail credentials or salaries.

const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

const toTemplate = (row) => ({
  id: Number(row.id),
  type: row.type,
  subject: row.subject,
  body: row.body,
  sendMode: row.send_mode,
  isActive: row.is_active,
  updatedAt: row.updated_at,
});

export async function listTemplates(db, { active } = {}) {
  const where = active === null || active === undefined ? '' : 'WHERE is_active = $1';
  const { rows } = await db.query(
    `SELECT id, type, subject, body, send_mode, is_active, updated_at
       FROM email_templates ${where} ORDER BY type`,
    where ? [active] : [],
  );
  return rows.map(toTemplate);
}

export async function findTemplate(db, id) {
  const { rows } = await db.query(
    `SELECT id, type, subject, body, send_mode, is_active, updated_at
       FROM email_templates WHERE id = $1`,
    [id],
  );
  return rows[0] ? toTemplate(rows[0]) : null;
}

// The active template the scheduler fills in for one notification type.
export async function findActiveTemplateByType(db, type) {
  const { rows } = await db.query(
    `SELECT id, type, subject, body FROM email_templates
      WHERE type = $1 AND is_active = true`,
    [type],
  );
  return rows[0] ? toTemplate(rows[0]) : null;
}

export async function insertTemplate(db, values, userId) {
  const { rows } = await db.query(
    `INSERT INTO email_templates (type, subject, body, send_mode, is_active, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $6)
     RETURNING id`,
    [values.type, values.subject, values.body, values.sendMode, values.isActive, userId],
  );
  return Number(rows[0].id);
}

const TEMPLATE_COLUMNS = {
  type: 'type',
  subject: 'subject',
  body: 'body',
  sendMode: 'send_mode',
  isActive: 'is_active',
};

export async function updateTemplate(db, id, changes, userId) {
  const names = Object.keys(changes);
  await db.query(
    `UPDATE email_templates
        SET ${names.map((n, i) => `${TEMPLATE_COLUMNS[n]} = $${i + 1}`).join(', ')},
            updated_at = now(), updated_by = $${names.length + 1}
      WHERE id = $${names.length + 2}`,
    [...names.map((n) => changes[n]), userId, id],
  );
}

const toNotification = (row) => ({
  id: Number(row.id),
  candidate: {
    id: Number(row.candidate_id),
    candidateCode: row.candidate_code,
    fullName: row.full_name,
  },
  type: row.type,
  dueAt: row.due_at,
  sendAt: row.send_at,
  sentAt: row.sent_at,
  recipients: row.recipients,
  status: row.status,
  attempts: row.attempts,
  lastError: row.last_error,
});

const NOTIFICATION_SELECT = `
  SELECT n.id, n.candidate_id, c.candidate_code, c.full_name, n.type,
         n.due_at, n.send_at, n.sent_at, n.recipients, n.status, n.attempts, n.last_error
    FROM notifications n
    JOIN candidates c ON c.id = n.candidate_id`;

export async function listNotifications(db, filters) {
  const where = [];
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.search) {
    const pattern = add(`%${escapeLike(filters.search)}%`);
    where.push(`(c.full_name ILIKE ${pattern} OR c.candidate_code ILIKE ${pattern})`);
  }
  if (filters.type) where.push(`n.type = ${add(filters.type)}`);
  if (filters.status) where.push(`n.status = ${add(filters.status)}`);
  if (filters.sent === true) where.push('n.sent_at IS NOT NULL');
  if (filters.sent === false) where.push('n.sent_at IS NULL');
  if (filters.dueFrom) where.push(`n.due_at >= ${add(filters.dueFrom)}::timestamptz`);
  if (filters.dueTo) where.push(`n.due_at <= ${add(filters.dueTo)}::timestamptz`);

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const total = await db.query(
    `SELECT count(*)::int AS total FROM notifications n
       JOIN candidates c ON c.id = n.candidate_id ${whereSql}`,
    params,
  );

  const limit = add(filters.pageSize);
  const offset = add((filters.page - 1) * filters.pageSize);
  const { rows } = await db.query(
    `${NOTIFICATION_SELECT} ${whereSql}
      ORDER BY n.send_at DESC, n.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  return { items: rows.map(toNotification), total: total.rows[0].total };
}

export async function findNotification(db, id) {
  const { rows } = await db.query(`${NOTIFICATION_SELECT} WHERE n.id = $1`, [id]);
  return rows[0] ? toNotification(rows[0]) : null;
}

// The rows the 15-minute job should look at, oldest first. Only ids: each
// row is then claimed one by one, so two overlapping runs never share one.
export async function listDueNotificationIds(db) {
  const { rows } = await db.query(
    `SELECT id FROM notifications
      WHERE status = 'pending' AND sent_at IS NULL AND send_at <= now()
      ORDER BY send_at, id`,
  );
  return rows.map((row) => Number(row.id));
}

// Claims one due notification inside a transaction. SKIP LOCKED makes a row
// invisible to a second run that arrives while this one holds it, and the
// re-checked WHERE makes a row already sent by an earlier run come back
// empty, so a notification can never be sent twice.
export async function claimDueNotification(db, id) {
  const { rows } = await db.query(
    `SELECT n.id, n.candidate_id, c.candidate_code, c.full_name, n.type, n.due_at, n.send_at,
            n.recipients, n.attempts
       FROM notifications n
       JOIN candidates c ON c.id = n.candidate_id
      WHERE n.id = $1 AND n.status = 'pending' AND n.sent_at IS NULL AND n.send_at <= now()
      FOR UPDATE OF n SKIP LOCKED`,
    [id],
  );
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    id: Number(row.id),
    candidateId: Number(row.candidate_id),
    candidateCode: row.candidate_code,
    fullName: row.full_name,
    type: row.type,
    dueAt: row.due_at,
    sendAt: row.send_at,
    recipients: row.recipients,
    attempts: Number(row.attempts),
  };
}

export async function markNotificationSent(db, id) {
  await db.query(
    `UPDATE notifications SET status = 'sent', sent_at = now(), attempts = attempts + 1,
            last_error = NULL
      WHERE id = $1`,
    [id],
  );
}

export async function markNotificationFailed(db, id, error) {
  await db.query(
    `UPDATE notifications SET status = 'failed', attempts = attempts + 1,
            last_error = left($2, 1000)
      WHERE id = $1`,
    [id, error],
  );
}

const toLogEntry = (row) => ({
  id: Number(row.id),
  candidate: row.log_candidate_id
    ? {
        id: Number(row.log_candidate_id),
        candidateCode: row.candidate_code,
        fullName: row.full_name,
      }
    : null,
  template: { id: Number(row.template_id), type: row.template_type },
  notificationId: row.notification_id ? Number(row.notification_id) : null,
  toAddresses: row.to_addresses,
  subjectSent: row.subject_sent,
  status: row.status,
  error: row.error,
  isResend: row.is_resend,
  sentBy: row.sent_by_name,
  sentAt: row.sent_at,
  createdAt: row.created_at,
});

const LOG_SELECT = `
  SELECT l.id, l.candidate_id AS log_candidate_id, c.candidate_code, c.full_name,
         l.template_id, t.type AS template_type, l.notification_id, l.to_addresses,
         l.subject_sent, l.status, l.error, l.is_resend, u.full_name AS sent_by_name,
         l.sent_at, l.created_at
    FROM email_log l
    JOIN email_templates t ON t.id = l.template_id
    LEFT JOIN candidates c ON c.id = l.candidate_id
    LEFT JOIN users u ON u.id = l.sent_by`;

export async function listEmailLog(db, filters) {
  const where = [];
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.recipient) {
    // Matches any address in the To list.
    const pattern = add(`%${escapeLike(filters.recipient)}%`);
    where.push(`EXISTS (SELECT 1 FROM unnest(l.to_addresses) AS a WHERE a ILIKE ${pattern})`);
  }
  if (filters.status) where.push(`l.status = ${add(filters.status)}`);
  if (filters.templateId) where.push(`l.template_id = ${add(filters.templateId)}`);
  if (filters.from) where.push(`l.created_at >= ${add(filters.from)}::timestamptz`);
  if (filters.to) where.push(`l.created_at <= ${add(filters.to)}::timestamptz`);

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const total = await db.query(
    `SELECT count(*)::int AS total FROM email_log l ${whereSql}`,
    params,
  );

  const limit = add(filters.pageSize);
  const offset = add((filters.page - 1) * filters.pageSize);
  const { rows } = await db.query(
    `${LOG_SELECT} ${whereSql} ORDER BY l.id DESC LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  return { items: rows.map(toLogEntry), total: total.rows[0].total };
}

export async function findLogEntry(db, id) {
  const { rows } = await db.query(`${LOG_SELECT} WHERE l.id = $1`, [id]);
  return rows[0] ? toLogEntry(rows[0]) : null;
}

// One delivery attempt, written before the send so a crash still leaves a
// queued row behind. body is the full text after placeholders.
export async function insertLogEntry(db, entry) {
  const { rows } = await db.query(
    `INSERT INTO email_log (candidate_id, template_id, notification_id, to_addresses,
                            cc_addresses, subject_sent, body_sent, is_resend, sent_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      entry.candidateId,
      entry.templateId,
      entry.notificationId ?? null,
      entry.toAddresses,
      entry.ccAddresses ?? null,
      entry.subjectSent,
      entry.bodySent ?? null,
      entry.isResend ?? false,
      entry.sentBy ?? null,
    ],
  );
  return Number(rows[0].id);
}

export async function markLogSent(db, id) {
  await db.query(`UPDATE email_log SET status = 'sent', sent_at = now() WHERE id = $1`, [id]);
}

export async function markLogFailed(db, id, error) {
  await db.query(`UPDATE email_log SET status = 'failed', error = left($2, 1000) WHERE id = $1`, [
    id,
    error,
  ]);
}

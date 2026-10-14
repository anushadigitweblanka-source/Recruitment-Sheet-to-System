import { inTransaction } from '../../db/transaction.js';
import { recordAudit } from '../audit/audit.js';
import {
  claimDueNotification,
  findActiveTemplateByType,
  findLogEntry,
  findTemplate,
  insertLogEntry,
  insertTemplate,
  listDueNotificationIds,
  markLogFailed,
  markLogSent,
  markNotificationFailed,
  markNotificationSent,
  updateTemplate,
} from './notifications.repository.js';
import { isEmailAddress, validateTemplate } from './notifications.validation.js';

const UNIQUE_VIOLATION = '23505';
const invalid = (fields) => ({ ok: false, reason: 'validation', fields });

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export async function createTemplate(pool, user, input) {
  const { values, errors } = validateTemplate(input);
  if (Object.keys(errors).length > 0) return invalid(errors);

  try {
    const id = await inTransaction(pool, async (db) => {
      const created = await insertTemplate(db, values, user.id);
      await recordAudit(db, {
        actorUserId: user.id,
        action: 'EMAIL_TEMPLATE_CREATE',
        entityType: 'email_templates',
        entityId: created,
        newValues: values,
      });
      return created;
    });
    return { ok: true, data: { template: await findTemplate(pool, id) } };
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return invalid({ type: 'A template with this type already exists. Edit that one instead.' });
    }
    throw err;
  }
}

export async function editTemplate(pool, user, id, input) {
  const current = await findTemplate(pool, id);
  if (!current) return { ok: false, reason: 'not_found' };

  const { values, errors } = validateTemplate(input, { partial: true });
  if (Object.keys(errors).length > 0) return invalid(errors);

  const changes = {};
  const before = {};
  for (const [name, value] of Object.entries(values)) {
    if (value !== current[name]) {
      changes[name] = value;
      before[name] = current[name];
    }
  }

  if (Object.keys(changes).length > 0) {
    try {
      await inTransaction(pool, async (db) => {
        await updateTemplate(db, id, changes, user.id);
        await recordAudit(db, {
          actorUserId: user.id,
          action: 'EMAIL_TEMPLATE_UPDATE',
          entityType: 'email_templates',
          entityId: id,
          oldValues: before,
          newValues: changes,
        });
      });
    } catch (err) {
      if (err.code === UNIQUE_VIOLATION) {
        return invalid({ type: 'A template with this type already exists.' });
      }
      throw err;
    }
  }
  return { ok: true, data: { template: await findTemplate(pool, id) } };
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

// The placeholders a template may use. Only values that are safe in a mail:
// never salaries, passwords or anything from the restricted tables.
function renderTemplate(text, notification) {
  return text
    .replaceAll('{name}', notification.fullName)
    .replaceAll('{candidate_code}', notification.candidateCode);
}

const badAddresses = (recipients) => recipients.filter((address) => !isEmailAddress(address));

// Sends one claimed notification inside its transaction. Everything this
// writes commits or rolls back together with the claim, so a crash cannot
// leave a notification half-sent.
async function deliverNotification(db, notification, mail) {
  const fail = async (message) => {
    await markNotificationFailed(db, notification.id, message);
    await recordAudit(db, {
      action: 'EMAIL_SEND_FAILED',
      entityType: 'notifications',
      entityId: notification.id,
      details: { type: notification.type, error: message },
    });
    return { outcome: 'failed', error: message };
  };

  const template = await findActiveTemplateByType(db, notification.type);
  if (!template) {
    return fail(`No active email template exists for type "${notification.type}".`);
  }

  const wrong = badAddresses(notification.recipients);
  if (wrong.length > 0) {
    return fail(`Not a valid email address: ${wrong.join(', ')}`);
  }

  // The guide's rule: the same template is never sent twice to the same
  // candidate unless explicitly resent. Checked here so the refusal can be
  // recorded; the unique index on email_log backs it up against races (a
  // violation there rolls this row back and it is refused on the next run).
  const already = await db.query(
    `SELECT 1 FROM email_log
      WHERE candidate_id = $1 AND template_id = $2
        AND is_resend = false AND status IN ('queued', 'sent')`,
    [notification.candidateId, template.id],
  );
  if (already.rows.length > 0) {
    return fail('This template was already sent to this candidate. Use Resend to send it again.');
  }

  const subject = renderTemplate(template.subject, notification);
  const body = renderTemplate(template.body, notification);

  const logId = await insertLogEntry(db, {
    candidateId: notification.candidateId,
    templateId: template.id,
    notificationId: notification.id,
    toAddresses: notification.recipients,
    subjectSent: subject,
    bodySent: body,
  });

  try {
    await mail.send({ to: notification.recipients, subject, body });
  } catch (err) {
    await markLogFailed(db, logId, err.message);
    return fail(`Delivery failed: ${err.message}`);
  }

  await markLogSent(db, logId);
  await markNotificationSent(db, notification.id);
  await recordAudit(db, {
    action: 'EMAIL_SEND',
    entityType: 'email_log',
    entityId: logId,
    details: { notificationId: notification.id, type: notification.type },
  });
  return { outcome: 'sent' };
}

// The job from the task guide: runs every 15 minutes, picks rows where
// send_at <= now AND sent_at IS NULL, sends them, records the result.
//
// Each row is claimed with FOR UPDATE SKIP LOCKED in its own transaction,
// so two overlapping runs (or two servers) never process the same row, and
// one failing mail never stops the rest or the application.
export async function runNotificationScheduler(pool, mail) {
  const ids = await listDueNotificationIds(pool);
  const summary = { mode: mail.mode, checked: ids.length, sent: 0, failed: 0, skipped: 0 };

  for (const id of ids) {
    try {
      const result = await inTransaction(pool, async (db) => {
        const notification = await claimDueNotification(db, id);
        if (!notification) return { outcome: 'skipped' };
        return deliverNotification(db, notification, mail);
      });
      summary[result.outcome] += 1;
    } catch (err) {
      // An unexpected error on one row (already rolled back) is counted and
      // the run continues with the next row.
      summary.failed += 1;
      console.error(`notification ${id} could not be processed: ${err.message}`);
    }
  }
  return summary;
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------

// "The same template is never sent twice to the same candidate unless it is
// explicitly resent." This is that explicit resend: a deliberate action by
// an authorized user, recorded as its own email_log row with is_resend set,
// leaving the original row untouched.
export async function resendEmail(pool, user, logId, mail) {
  const original = await findLogEntry(pool, logId);
  if (!original) return { ok: false, reason: 'not_found' };
  if (original.status === 'queued') {
    return invalid({ resend: 'This mail is still being sent.' });
  }

  const id = await inTransaction(pool, async (db) => {
    const newId = await insertLogEntry(db, {
      candidateId: original.candidate?.id ?? null,
      templateId: original.template.id,
      notificationId: original.notificationId,
      toAddresses: original.toAddresses,
      subjectSent: original.subjectSent,
      bodySent: null,
      isResend: true,
      sentBy: user.id,
    });

    try {
      await mail.send({ to: original.toAddresses, subject: original.subjectSent });
      await markLogSent(db, newId);
    } catch (err) {
      await markLogFailed(db, newId, err.message);
    }

    await recordAudit(db, {
      actorUserId: user.id,
      action: 'EMAIL_RESEND',
      entityType: 'email_log',
      entityId: newId,
      details: { originalLogId: original.id, templateType: original.template.type },
    });
    return newId;
  });

  return { ok: true, data: { entry: await findLogEntry(pool, id) } };
}

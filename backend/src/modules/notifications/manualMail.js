// The guide's one-off mails: preview, one-click send, resend, and the same
// mails sent automatically when their template is set to Auto.
//
//   interview_invitation     to the candidate (carries the Company CV
//                            template and the candidate's upload link)
//   team_lead_summary        to the Team Lead of the candidate's position
//   joining_onboarding       to the candidate
//   status_rejected_on_hold  to the candidate
//
// Safety rules from the guide, all enforced here:
//   - a mail is blocked (never sent) when a required address, date or Team
//     Lead is missing
//   - the same template is never sent twice to the same candidate unless HR
//     presses Resend; a resend is its own log row
//   - HR may edit one mail before sending; the edited text is what is logged
//   - nothing is sent without being logged, and the mail adapter is the
//     development one unless a provider has been approved

import { inTransaction } from '../../db/transaction.js';
import { recordAudit } from '../audit/audit.js';
import { createUploadLink, markCompanyCvSent } from '../company-cv/companyCv.service.js';
import { INVITE_TEMPLATE_TYPE, asAttachment, inviteForTeamLeadMail } from './calendarInvite.js';
import { TEMPLATE_TYPES, renderTemplate } from './emailTypes.js';
import { loadMailContext, placeholderValues, readMailSettings } from './mailContext.js';
import {
  findActiveTemplateByType,
  insertLogEntry,
  markLogFailed,
  markLogSent,
} from './notifications.repository.js';
import { isEmailAddress } from './notifications.validation.js';

const UNIQUE_VIOLATION = '23505';
const MAX_SUBJECT = 200;
const MAX_BODY = 10000;

// Shown in a preview where the candidate's own upload link will go; replaced
// by the real link when the mail is sent (also inside an edited body).
export const PREVIEW_LINK_MARKER = '[the candidate’s own upload link]';

const invalid = (fields) => ({ ok: false, reason: 'validation', fields });

// The guide: the Main User approves offer mails. The joining / onboarding mail
// is the offer-related mail, so when anyone but the Main User sends it, it is
// only PREPARED: stored as a queued email_log row (no migration needed - a
// committed queued row is exactly a mail waiting for approval, because a mail
// being delivered is queued and finished inside one transaction). The Main
// User then approves (it is sent) or rejects (it is marked failed, so a new
// one can be prepared). The Main User's own send is the approval.
export const APPROVAL_REQUIRED_TYPES = ['joining_onboarding'];
const APPROVER_PERMISSION = 'admin.manage';
export const canApproveMail = (user) => Boolean(user?.permissions?.includes(APPROVER_PERMISSION));

export const MANUAL_TYPES = Object.keys(TEMPLATE_TYPES).filter((t) => TEMPLATE_TYPES[t].manual);

// Who a type goes to, and what it cannot be sent without.
function requirements(type, context, settings) {
  const missing = [];
  let to = [];
  let cc = [];

  switch (type) {
    case 'interview_invitation':
      if (!context.email) missing.push('candidate email');
      if (!context.interviewAt) missing.push('interview date and time');
      to = [context.email];
      break;
    case 'team_lead_summary':
      if (!context.teamLeadEmail) missing.push('team lead for the candidate position');
      if (!context.interviewAt) missing.push('interview date and time');
      to = [context.teamLeadEmail];
      cc = settings.hrEmails;
      break;
    case 'joining_onboarding':
      if (!context.email) missing.push('candidate email');
      if (!context.onboardingDate) missing.push('joining date');
      to = [context.email];
      break;
    case 'status_rejected_on_hold':
      if (!context.email) missing.push('candidate email');
      if (!['rejected', 'on_hold'].includes(context.stage)) {
        missing.push('candidate status Rejected or On Hold');
      }
      to = [context.email];
      break;
    default:
      break;
  }
  return { missing, to: to.filter(Boolean), cc: cc.filter(Boolean) };
}

// Builds the mail without sending it. `uploadLink` is given at send time; a
// preview shows where the candidate's own link will go.
async function build(db, { candidateId, type, uploadLink }) {
  if (!MANUAL_TYPES.includes(type)) {
    return invalid({ type: `Mail type must be one of: ${MANUAL_TYPES.join(', ')}.` });
  }
  const context = await loadMailContext(db, candidateId);
  if (!context) return { ok: false, reason: 'not_found' };

  const template = await findActiveTemplateByType(db, type);
  if (!template) return invalid({ type: `No active email template exists for "${type}".` });

  const settings = await readMailSettings(db);
  const { missing, to, cc } = requirements(type, context, settings);
  // The Team Lead summary carries a calendar invitation; it is never made from
  // incomplete interview information.
  let invite = null;
  if (type === INVITE_TEMPLATE_TYPE && missing.length === 0) {
    invite = await inviteForTeamLeadMail(db, { context, settings, templateId: template.id });
    if (!invite.ok) missing.push(...invite.missing);
  }
  const kind = type === 'joining_onboarding' ? 'joining' : 'interview';
  const values = placeholderValues(context, settings, {
    kind,
    extra:
      type === 'interview_invitation'
        ? {
            company_cv_template: settings.companyCvTemplateUrl,
            company_cv_upload_link: uploadLink ?? PREVIEW_LINK_MARKER,
          }
        : {},
  });

  return {
    ok: true,
    context,
    template,
    missing,
    to,
    cc,
    invite: invite?.ok ? invite : null,
    subject: renderTemplate(template.subject, values),
    body: renderTemplate(template.body, values),
  };
}

// "Preview before manual sending."
export async function previewMail(pool, { candidateId, type }) {
  const built = await build(pool, { candidateId, type });
  if (!built.ok) return built;
  return {
    ok: true,
    data: {
      type,
      sendMode: built.template.sendMode,
      to: built.to,
      cc: built.cc,
      subject: built.subject,
      body: built.body,
      missing: built.missing,
      canSend: built.missing.length === 0,
      calendarInvite: built.invite
        ? {
            filename: built.invite.filename,
            method: built.invite.method,
            startsAt: built.invite.startsAt,
            sequence: built.invite.sequence,
          }
        : null,
    },
  };
}

// Checks an edited subject and body. Anything left out keeps the template's.
function validateEdit(input, fallback) {
  const errors = {};
  const subject = input.subject === undefined ? fallback.subject : String(input.subject).trim();
  const body = input.body === undefined ? fallback.body : String(input.body).trim();
  if (!subject) errors.subject = 'Subject is required.';
  else if (subject.length > MAX_SUBJECT) {
    errors.subject = `Subject must be at most ${MAX_SUBJECT} characters.`;
  }
  if (!body) errors.body = 'Body is required.';
  else if (body.length > MAX_BODY) errors.body = `Body must be at most ${MAX_BODY} characters.`;
  return { subject, body, errors };
}

// One-click send (and resend). `user` is null for a mail the system sends on
// its own because the template is set to Auto.
export async function sendMail(pool, user, input, mail, { config }) {
  const { candidateId, type } = input;
  const resend = input.resend === true;

  try {
    return await inTransaction(pool, async (db) => {
      const built = await build(db, { candidateId, type });
      if (!built.ok) return built;

      if (built.missing.length > 0) {
        return invalid({ mail: `Cannot send: missing ${built.missing.join(', ')}.` });
      }
      const wrong = [...built.to, ...built.cc].filter((address) => !isEmailAddress(address));
      if (wrong.length > 0)
        return invalid({ mail: `Not a valid email address: ${wrong.join(', ')}` });

      const edited = validateEdit(input, built);
      if (Object.keys(edited.errors).length > 0) return invalid(edited.errors);

      if (resend) {
        const before = await db.query(
          `SELECT 1 FROM email_log WHERE candidate_id = $1 AND template_id = $2
              AND notification_id IS NULL AND status IN ('queued', 'sent')`,
          [candidateId, built.template.id],
        );
        if (before.rows.length === 0) {
          return invalid({
            resend: 'This mail has not been sent before, so there is nothing to resend.',
          });
        }
      }

      // An offer-related mail prepared by someone who cannot approve it waits
      // for the Main User. Nothing is delivered and nothing about salary is
      // involved: the text is the template's, filled with the safe placeholders.
      if (user && APPROVAL_REQUIRED_TYPES.includes(type) && !canApproveMail(user)) {
        const waiting = await db.query(
          `SELECT 1 FROM email_log WHERE candidate_id = $1 AND template_id = $2
              AND notification_id IS NULL AND status = 'queued'`,
          [candidateId, built.template.id],
        );
        if (waiting.rows.length > 0) {
          return invalid({
            mail: 'This mail is already waiting for the Main User\u2019s approval.',
          });
        }
        const preparedId = await insertLogEntry(db, {
          candidateId,
          templateId: built.template.id,
          toAddresses: built.to,
          ccAddresses: built.cc.length > 0 ? built.cc : null,
          subjectSent: edited.subject,
          bodySent: edited.body,
          isResend: resend,
          sentBy: user.id,
        });
        await recordAudit(db, {
          actorUserId: user.id,
          action: 'EMAIL_PREPARE',
          entityType: 'email_log',
          entityId: preparedId,
          details: { type, candidateId, resend },
        });
        return {
          ok: true,
          data: {
            logId: preparedId,
            delivered: false,
            pendingApproval: true,
            error: null,
            to: built.to,
          },
        };
      }

      // Everything has been checked, so the candidate's own upload link is
      // made now (and not for a mail that was refused).
      if (type === 'interview_invitation') {
        const uploadLink = await createUploadLink(db, {
          candidateId,
          userId: user?.id ?? null,
          baseUrl: config.publicBaseUrl,
        });
        edited.subject = edited.subject.replaceAll(PREVIEW_LINK_MARKER, uploadLink);
        edited.body = edited.body.replaceAll(PREVIEW_LINK_MARKER, uploadLink);
      }

      const logId = await insertLogEntry(db, {
        candidateId,
        templateId: built.template.id,
        toAddresses: built.to,
        ccAddresses: built.cc.length > 0 ? built.cc : null,
        subjectSent: edited.subject,
        bodySent: edited.body,
        isResend: resend,
        sentBy: user?.id ?? null,
      });

      let delivered = true;
      let error = null;
      try {
        await mail.send({
          to: built.to,
          cc: built.cc,
          subject: edited.subject,
          body: edited.body,
          ...(built.invite ? { attachments: [asAttachment(built.invite)] } : {}),
        });
        await markLogSent(db, logId);
      } catch (err) {
        delivered = false;
        error = err.message;
        await markLogFailed(db, logId, err.message);
      }

      if (delivered && type === 'interview_invitation') await markCompanyCvSent(db, candidateId);

      await recordAudit(db, {
        actorUserId: user?.id ?? null,
        action: delivered ? (resend ? 'EMAIL_RESEND' : 'EMAIL_SEND') : 'EMAIL_SEND_FAILED',
        entityType: 'email_log',
        entityId: logId,
        details: { type, candidateId, auto: user === null, ...(error ? { error } : {}) },
      });

      return { ok: true, data: { logId, delivered, error, to: built.to } };
    });
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      return invalid({
        mail: 'This mail was already sent to this candidate. Use Resend to send it again.',
      });
    }
    throw err;
  }
}

// The mails that go out by themselves when the candidate is given a direct
// interview slot, for the types whose template is set to Auto. Never throws:
// a failed automatic mail must not undo the change that triggered it.
export async function sendAutomaticInterviewMails(pool, { candidateId, mail, config }) {
  const results = [];
  const context = await loadMailContext(pool, candidateId);
  if (context?.stage !== 'interview_scheduled') return results;

  for (const type of ['interview_invitation', 'team_lead_summary']) {
    try {
      const template = await findActiveTemplateByType(pool, type);
      if (!template || template.sendMode !== 'auto') continue;
      // Already sent once: an edit of the interview must not send it again.
      const sent = await pool.query(
        `SELECT 1 FROM email_log WHERE candidate_id = $1 AND template_id = $2
            AND notification_id IS NULL AND status IN ('queued', 'sent')`,
        [candidateId, template.id],
      );
      if (sent.rows.length > 0) continue;
      const result = await sendMail(pool, null, { candidateId, type }, mail, { config });
      results.push({ type, ok: result.ok });
      if (!result.ok) {
        await recordAudit(pool, {
          action: 'EMAIL_AUTO_BLOCKED',
          entityType: 'candidates',
          entityId: candidateId,
          details: { type, fields: Object.keys(result.fields ?? {}) },
        });
      }
    } catch (err) {
      results.push({ type, ok: false });
      console.error(`automatic ${type} mail failed: ${err.message}`);
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Main User approval of prepared offer mails
// ---------------------------------------------------------------------------

const toApproval = (row) => ({
  id: Number(row.id),
  candidate: {
    id: Number(row.candidate_id),
    candidateCode: row.candidate_code,
    fullName: row.full_name,
  },
  type: row.type,
  to: row.to_addresses,
  cc: row.cc_addresses ?? [],
  subject: row.subject_sent,
  body: row.body_sent,
  isResend: row.is_resend,
  preparedBy: row.prepared_by,
  preparedAt: row.created_at,
});

const APPROVAL_SELECT = `
  SELECT l.id, l.candidate_id, c.candidate_code, c.full_name, t.type, l.to_addresses,
         l.cc_addresses, l.subject_sent, l.body_sent, l.is_resend, l.created_at,
         u.full_name AS prepared_by
    FROM email_log l
    JOIN email_templates t ON t.id = l.template_id
    JOIN candidates c ON c.id = l.candidate_id
    LEFT JOIN users u ON u.id = l.sent_by
   WHERE l.status = 'queued' AND l.notification_id IS NULL AND t.type = ANY($1)`;

export async function listPendingApprovals(db) {
  const { rows } = await db.query(`${APPROVAL_SELECT} ORDER BY l.id`, [APPROVAL_REQUIRED_TYPES]);
  return rows.map(toApproval);
}

// Sends a prepared mail. Only a user who passes canApproveMail may call it
// (the route enforces it; this checks again, so no caller can skip it).
export async function approveMail(pool, user, logId, mail) {
  if (!canApproveMail(user)) return { ok: false, reason: 'forbidden' };

  return inTransaction(pool, async (db) => {
    const { rows } = await db.query(`${APPROVAL_SELECT} AND l.id = $2 FOR UPDATE OF l`, [
      APPROVAL_REQUIRED_TYPES,
      logId,
    ]);
    if (rows.length === 0) return { ok: false, reason: 'not_found' };
    const entry = toApproval(rows[0]);

    let delivered = true;
    let error = null;
    try {
      await mail.send({ to: entry.to, cc: entry.cc, subject: entry.subject, body: entry.body });
      await markLogSent(db, logId);
    } catch (err) {
      delivered = false;
      error = err.message;
      await markLogFailed(db, logId, err.message);
    }
    await recordAudit(db, {
      actorUserId: user.id,
      action: delivered ? 'EMAIL_APPROVE' : 'EMAIL_SEND_FAILED',
      entityType: 'email_log',
      entityId: logId,
      details: { type: entry.type, candidateId: entry.candidate.id, ...(error ? { error } : {}) },
    });
    return { ok: true, data: { logId, delivered, error } };
  });
}

// Refuses a prepared mail. It is marked failed with the reason, which also
// frees the candidate and template so a corrected mail can be prepared.
export async function rejectMail(pool, user, logId, reason) {
  if (!canApproveMail(user)) return { ok: false, reason: 'forbidden' };
  const text = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';

  return inTransaction(pool, async (db) => {
    const { rows } = await db.query(`${APPROVAL_SELECT} AND l.id = $2 FOR UPDATE OF l`, [
      APPROVAL_REQUIRED_TYPES,
      logId,
    ]);
    if (rows.length === 0) return { ok: false, reason: 'not_found' };
    await markLogFailed(db, logId, `Rejected by the Main User${text ? `: ${text}` : ''}`);
    await recordAudit(db, {
      actorUserId: user.id,
      action: 'EMAIL_REJECT',
      entityType: 'email_log',
      entityId: logId,
      details: { type: rows[0].type, candidateId: Number(rows[0].candidate_id) },
    });
    return { ok: true, data: { logId } };
  });
}

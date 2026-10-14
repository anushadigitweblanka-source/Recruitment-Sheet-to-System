import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import { createMailService } from './mailService.js';
import {
  findNotification,
  findTemplate,
  listEmailLog,
  listNotifications,
  listTemplates,
} from './notifications.repository.js';
import {
  createTemplate,
  editTemplate,
  resendEmail,
  runNotificationScheduler,
} from './notifications.service.js';
import {
  parseEmailLogQuery,
  parseNotificationsQuery,
  parseTemplatesQuery,
} from './notifications.validation.js';

function sendResult(res, result, successStatus = 200) {
  if (result.ok) return res.status(successStatus).json(result.data);
  if (result.reason === 'not_found') {
    return res.status(404).json({ error: 'not_found', message: 'Not found.' });
  }
  return res.status(422).json({
    error: 'validation_failed',
    message: 'Some fields need correcting.',
    fields: result.fields,
  });
}

const positiveId = (raw) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// Three route groups for Module 6: the notification schedule, the editable
// email templates, and the email log. Viewing follows the same permission as
// the other candidate screens; changing anything needs notifications.manage.
export function notificationsRouter({ config, pool }) {
  const router = Router();
  const canView = requirePermission('candidates.view');
  const canManage = requirePermission('notifications.manage');
  const mail = createMailService(config);
  const notFound = { ok: false, reason: 'not_found' };

  router.get('/notifications', canView, async (req, res) => {
    const filters = parseNotificationsQuery(req.query);
    const { items, total } = await listNotifications(pool, filters);
    res.json({ items, total, page: filters.page, pageSize: filters.pageSize, mailMode: mail.mode });
  });

  // Development trigger for the 15-minute job, so a reminder can be tested
  // without waiting. Refused in production: there the job runs on its own.
  router.post('/notifications/run', canManage, async (req, res) => {
    if (config.environment === 'production') {
      return res.status(403).json({
        error: 'forbidden',
        message: 'The scheduler runs on its own in production and cannot be triggered by hand.',
      });
    }
    res.json(await runNotificationScheduler(pool, mail));
  });

  router.get('/notifications/:id', canView, async (req, res) => {
    const id = positiveId(req.params.id);
    const data = id ? await findNotification(pool, id) : null;
    sendResult(res, data ? { ok: true, data: { notification: data } } : notFound);
  });

  router.get('/email-templates', canView, async (req, res) => {
    const { active } = parseTemplatesQuery(req.query);
    res.json({ items: await listTemplates(pool, { active }) });
  });

  router.post('/email-templates', canManage, async (req, res) => {
    sendResult(res, await createTemplate(pool, req.user, req.body), 201);
  });

  router.get('/email-templates/:id', canView, async (req, res) => {
    const id = positiveId(req.params.id);
    const data = id ? await findTemplate(pool, id) : null;
    sendResult(res, data ? { ok: true, data: { template: data } } : notFound);
  });

  router.patch('/email-templates/:id', canManage, async (req, res) => {
    const id = positiveId(req.params.id);
    sendResult(res, id ? await editTemplate(pool, req.user, id, req.body) : notFound);
  });

  router.get('/email-log', canView, async (req, res) => {
    const filters = parseEmailLogQuery(req.query);
    const { items, total } = await listEmailLog(pool, filters);
    res.json({ items, total, page: filters.page, pageSize: filters.pageSize, mailMode: mail.mode });
  });

  router.post('/email-log/:id/resend', canManage, async (req, res) => {
    const id = positiveId(req.params.id);
    sendResult(res, id ? await resendEmail(pool, req.user, id, mail) : notFound, 201);
  });

  return router;
}

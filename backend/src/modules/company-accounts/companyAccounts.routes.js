import { Router } from 'express';
import { requirePermission } from '../../middleware/auth.js';
import {
  clearPassword,
  findAccount,
  listAccounts,
  markCreated,
  markDisabled,
  markHandedOver,
  resetPassword,
  revealPassword,
  setPassword,
} from './companyAccounts.service.js';
import { SecretKeyMissingError } from './secrets.js';

const STATUSES = ['requested', 'created', 'handed_over', 'disabled'];

const positiveId = (raw) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

function sendResult(res, result, successStatus = 200) {
  if (result.ok) return res.status(successStatus).json(result.data);
  if (result.reason === 'not_found') {
    return res.status(404).json({ error: 'not_found', message: 'Company account not found.' });
  }
  return res.status(422).json({
    error: 'validation_failed',
    message: 'Some fields need correcting.',
    fields: result.fields,
  });
}

// Account status changes need company_accounts.manage (HR and the Main User).
// Anything to do with the temporary password needs company_accounts.password,
// which only the Main User holds. Passwords are never in a list or a detail.
export function companyAccountsRouter({ config, pool }) {
  const router = Router();
  const canManage = requirePermission('company_accounts.manage');
  const canUsePassword = requirePermission('company_accounts.password');

  // A missing or invalid encryption key is a configuration problem, not a
  // user error: say so plainly, without any detail.
  const guardKey = (handler) => async (req, res) => {
    try {
      await handler(req, res);
    } catch (err) {
      if (err instanceof SecretKeyMissingError) {
        return res.status(503).json({
          error: 'secret_key_missing',
          message: 'Temporary passwords are not available: the encryption key is not configured.',
        });
      }
      throw err;
    }
  };

  router.get('/', canManage, async (req, res) => {
    const status = STATUSES.includes(req.query.status) ? req.query.status : null;
    const page = positiveId(req.query.page) ?? 1;
    const pageSize = Math.min(positiveId(req.query.pageSize) ?? 20, 100);
    const { items, total } = await listAccounts(pool, { status, page, pageSize });
    res.json({ items, total, page, pageSize });
  });

  router.get('/:id', canManage, async (req, res) => {
    const id = positiveId(req.params.id);
    const account = id ? await findAccount(pool, id) : null;
    sendResult(res, account ? { ok: true, data: { account } } : { ok: false, reason: 'not_found' });
  });

  const withId = (work) => async (req, res) => {
    const id = positiveId(req.params.id);
    if (!id) return sendResult(res, { ok: false, reason: 'not_found' });
    sendResult(res, await work(req, id));
  };

  router.post(
    '/:id/created',
    canManage,
    withId((req, id) => markCreated(pool, req.user, id, req.body)),
  );
  router.post(
    '/:id/handed-over',
    canManage,
    withId((req, id) => markHandedOver(pool, req.user, id, req.body)),
  );
  router.post(
    '/:id/disabled',
    canManage,
    withId((req, id) => markDisabled(pool, req.user, id, req.body)),
  );

  router.put(
    '/:id/password',
    canUsePassword,
    guardKey(withId((req, id) => setPassword(pool, req.user, id, req.body, config))),
  );
  router.post(
    '/:id/password/reset',
    canUsePassword,
    guardKey(withId((req, id) => resetPassword(pool, req.user, id, config))),
  );
  router.post(
    '/:id/password/reveal',
    canUsePassword,
    guardKey(withId((req, id) => revealPassword(pool, req.user, id, req.body, config))),
  );
  router.delete(
    '/:id/password',
    canUsePassword,
    withId((req, id) => clearPassword(pool, req.user, id)),
  );

  return router;
}

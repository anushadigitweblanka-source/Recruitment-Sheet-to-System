import { inTransaction } from '../../db/transaction.js';
import { recordAudit } from '../audit/audit.js';
import { verifyPassword } from '../auth/passwords.js';
import { isRealDate } from '../employees/lifecycleDates.js';
import { decryptSecret, encryptSecret, generateTemporaryPassword } from './secrets.js';

// The company account lifecycle from the task guide:
//
//   Attended = Yes          -> Requested
//   IT marks Created        -> Created   (with the company email)
//   HR marks Handed over    -> Handed over
//   Discontinued/Terminated -> a Disable action is recorded, and the status
//                              becomes Disabled when it is completed
//
// Temporary passwords: never plaintext, encrypted in their own table, shown
// only to the Main User who re-enters their own login password, for 30
// seconds; every reveal, edit and reset is logged; and the stored password is
// deleted once the employee has changed it. Nothing here ever puts a password
// in a list, report, export, mail, notification or log.

export const REVEAL_SECONDS = 30;
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PASSWORD = 200;

const invalid = (fields) => ({ ok: false, reason: 'validation', fields });
const today = () => new Date().toISOString().slice(0, 10);

const toAccount = (row) => ({
  id: Number(row.id),
  candidate: {
    id: Number(row.candidate_id),
    candidateCode: row.candidate_code,
    fullName: row.full_name,
  },
  employeeId: row.employee_id ? Number(row.employee_id) : null,
  companyEmail: row.company_email,
  status: row.status,
  requestedAt: row.requested_at,
  createdDate: row.created_date,
  handedOverDate: row.handed_over_date,
  disablePending: row.disable_requested_at !== null && row.status !== 'disabled',
  disabledDate: row.disabled_date,
  // Only whether one is stored. The value is never part of an account.
  hasStoredPassword: row.has_secret,
});

const ACCOUNT_SELECT = `
  SELECT a.id, a.candidate_id, c.candidate_code, c.full_name, a.employee_id, a.company_email,
         a.status, a.requested_at, to_char(a.created_date, 'YYYY-MM-DD') AS created_date,
         to_char(a.handed_over_date, 'YYYY-MM-DD') AS handed_over_date,
         a.disable_requested_at, to_char(a.disabled_date, 'YYYY-MM-DD') AS disabled_date,
         EXISTS (SELECT 1 FROM company_account_secrets s WHERE s.account_id = a.id) AS has_secret
    FROM company_accounts a
    JOIN candidates c ON c.id = a.candidate_id`;

export async function findAccount(db, id) {
  const { rows } = await db.query(`${ACCOUNT_SELECT} WHERE a.id = $1`, [id]);
  return rows[0] ? toAccount(rows[0]) : null;
}

export async function findAccountForCandidate(db, candidateId) {
  const { rows } = await db.query(`${ACCOUNT_SELECT} WHERE a.candidate_id = $1`, [candidateId]);
  return rows[0] ? toAccount(rows[0]) : null;
}

export async function listAccounts(db, { status = null, page = 1, pageSize = 20 } = {}) {
  const params = [];
  let where = '';
  if (status) {
    params.push(status);
    where = `WHERE a.status = $1`;
  }
  const total = await db.query(
    `SELECT count(*)::int AS total FROM company_accounts a ${where}`,
    params,
  );
  params.push(pageSize, (page - 1) * pageSize);
  const { rows } = await db.query(
    `${ACCOUNT_SELECT} ${where} ORDER BY a.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { items: rows.map(toAccount), total: total.rows[0].total };
}

// ---------------------------------------------------------------------------
// Lifecycle hooks (run inside the transaction of the change that causes them)
// ---------------------------------------------------------------------------

// "Attended = Yes -> Account Requested". A second call never adds a second
// account.
export async function requestCompanyAccount(db, { candidateId, employeeId, userId }) {
  const { rows } = await db.query(
    `INSERT INTO company_accounts (candidate_id, employee_id, updated_by)
     VALUES ($1, $2, $3)
     ON CONFLICT (candidate_id) DO NOTHING
     RETURNING id`,
    [candidateId, employeeId, userId],
  );
  if (rows.length === 0) return null;
  const id = Number(rows[0].id);
  await recordAudit(db, {
    actorUserId: userId,
    action: 'COMPANY_ACCOUNT_REQUEST',
    entityType: 'company_accounts',
    entityId: id,
    newValues: { candidateId, status: 'requested' },
  });
  return id;
}

// "On Discontinued/Terminated -> record the Disable Account action". An
// account that was never created is simply closed; one that exists waits to be
// disabled by IT and then completed here.
export async function requestAccountDisable(db, { candidateId, userId }) {
  const { rows } = await db.query(
    'SELECT id, status FROM company_accounts WHERE candidate_id = $1 FOR UPDATE',
    [candidateId],
  );
  const account = rows[0];
  if (!account || account.status === 'disabled') return null;
  const id = Number(account.id);

  if (account.status === 'requested') {
    await db.query(
      `UPDATE company_accounts
          SET status = 'disabled', disabled_date = CURRENT_DATE, disable_requested_at = now(),
              disabled_by = $2, updated_at = now(), updated_by = $2
        WHERE id = $1`,
      [id, userId],
    );
  } else {
    await db.query(
      `UPDATE company_accounts
          SET disable_requested_at = COALESCE(disable_requested_at, now()),
              updated_at = now(), updated_by = $2
        WHERE id = $1`,
      [id, userId],
    );
  }
  await db.query('DELETE FROM company_account_secrets WHERE account_id = $1', [id]);
  await recordAudit(db, {
    actorUserId: userId,
    action: 'COMPANY_ACCOUNT_DISABLE_REQUEST',
    entityType: 'company_accounts',
    entityId: id,
    details: { closedImmediately: account.status === 'requested' },
  });
  return id;
}

// ---------------------------------------------------------------------------
// Status changes
// ---------------------------------------------------------------------------

async function lockAccount(db, id) {
  const { rows } = await db.query(
    'SELECT id, candidate_id, status, disable_requested_at FROM company_accounts WHERE id = $1 FOR UPDATE',
    [id],
  );
  return rows[0] ?? null;
}

const validDate = (value, label, errors, name) => {
  if (value === undefined || value === null || value === '') return today();
  if (!isRealDate(value)) {
    errors[name] = `${label} must be a real date (YYYY-MM-DD).`;
    return null;
  }
  return value;
};

// "IT marks Created."
export async function markCreated(pool, user, id, input) {
  const errors = {};
  const email =
    typeof input?.companyEmail === 'string' ? input.companyEmail.trim().toLowerCase() : '';
  if (!email) errors.companyEmail = 'Company Email is required.';
  else if (!EMAIL_SHAPE.test(email)) errors.companyEmail = 'Company Email is not a valid address.';
  const createdDate = validDate(input?.createdDate, 'Created Date', errors, 'createdDate');
  if (Object.keys(errors).length > 0) return invalid(errors);

  return inTransaction(pool, async (db) => {
    const account = await lockAccount(db, id);
    if (!account) return { ok: false, reason: 'not_found' };
    if (account.status !== 'requested') {
      return invalid({ status: 'Only a requested account can be marked Created.' });
    }
    await db.query(
      `UPDATE company_accounts
          SET status = 'created', company_email = $2, created_date = $3, created_by = $4,
              updated_at = now(), updated_by = $4
        WHERE id = $1`,
      [id, email, createdDate, user.id],
    );
    await recordAudit(db, {
      actorUserId: user.id,
      action: 'COMPANY_ACCOUNT_CREATED',
      entityType: 'company_accounts',
      entityId: id,
      oldValues: { status: 'requested' },
      newValues: { status: 'created', createdDate },
    });
    return { ok: true, data: { account: await findAccount(db, id) } };
  }).catch((err) => {
    if (err.code === '23505') return invalid({ companyEmail: 'This address is already in use.' });
    throw err;
  });
}

// "HR marks Handed over."
export async function markHandedOver(pool, user, id, input) {
  const errors = {};
  const handedOverDate = validDate(
    input?.handedOverDate,
    'Handed Over Date',
    errors,
    'handedOverDate',
  );
  if (Object.keys(errors).length > 0) return invalid(errors);

  return inTransaction(pool, async (db) => {
    const account = await lockAccount(db, id);
    if (!account) return { ok: false, reason: 'not_found' };
    if (account.status !== 'created') {
      return invalid({ status: 'Only a created account can be marked Handed over.' });
    }
    await db.query(
      `UPDATE company_accounts
          SET status = 'handed_over', handed_over_date = $2, handed_over_by = $3,
              updated_at = now(), updated_by = $3
        WHERE id = $1`,
      [id, handedOverDate, user.id],
    );
    await recordAudit(db, {
      actorUserId: user.id,
      action: 'COMPANY_ACCOUNT_HANDED_OVER',
      entityType: 'company_accounts',
      entityId: id,
      oldValues: { status: 'created' },
      newValues: { status: 'handed_over', handedOverDate },
    });
    return { ok: true, data: { account: await findAccount(db, id) } };
  });
}

// The Disable action is completed.
export async function markDisabled(pool, user, id, input) {
  const errors = {};
  const disabledDate = validDate(input?.disabledDate, 'Disabled Date', errors, 'disabledDate');
  if (Object.keys(errors).length > 0) return invalid(errors);

  return inTransaction(pool, async (db) => {
    const account = await lockAccount(db, id);
    if (!account) return { ok: false, reason: 'not_found' };
    if (account.status === 'disabled')
      return invalid({ status: 'This account is already disabled.' });
    if (!account.disable_requested_at) {
      return invalid({
        status: 'A disable action is recorded when the employee is discontinued or terminated.',
      });
    }
    await db.query(
      `UPDATE company_accounts
          SET status = 'disabled', disabled_date = $2, disabled_by = $3,
              updated_at = now(), updated_by = $3
        WHERE id = $1`,
      [id, disabledDate, user.id],
    );
    await db.query('DELETE FROM company_account_secrets WHERE account_id = $1', [id]);
    await recordAudit(db, {
      actorUserId: user.id,
      action: 'COMPANY_ACCOUNT_DISABLED',
      entityType: 'company_accounts',
      entityId: id,
      oldValues: { status: account.status },
      newValues: { status: 'disabled', disabledDate },
    });
    return { ok: true, data: { account: await findAccount(db, id) } };
  });
}

// ---------------------------------------------------------------------------
// Temporary password (Main User only)
// ---------------------------------------------------------------------------

async function storeSecret(db, config, account, user, plaintext) {
  const encrypted = encryptSecret(config, account.id, plaintext);
  await db.query(
    `INSERT INTO company_account_secrets (account_id, ciphertext, iv, auth_tag, updated_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (account_id) DO UPDATE
        SET ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv, auth_tag = EXCLUDED.auth_tag,
            updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [account.id, encrypted.ciphertext, encrypted.iv, encrypted.authTag, user.id],
  );
}

const needsLiveAccount = (account) =>
  account.status === 'created' || account.status === 'handed_over'
    ? null
    : invalid({ status: 'A temporary password can only be kept for a created account.' });

// Typing in a temporary password.
export async function setPassword(pool, user, id, input, config) {
  const password = typeof input?.password === 'string' ? input.password : '';
  if (!password) return invalid({ password: 'Password is required.' });
  if (password.length > MAX_PASSWORD) {
    return invalid({ password: `Password must be at most ${MAX_PASSWORD} characters.` });
  }

  return inTransaction(pool, async (db) => {
    const account = await lockAccount(db, id);
    if (!account) return { ok: false, reason: 'not_found' };
    const refused = needsLiveAccount(account);
    if (refused) return refused;
    await storeSecret(db, config, account, user, password);
    await recordAudit(db, {
      actorUserId: user.id,
      action: 'COMPANY_PASSWORD_EDIT',
      entityType: 'company_accounts',
      entityId: id,
    });
    return { ok: true, data: { account: await findAccount(db, id) } };
  });
}

// Reset: a new random temporary password replaces the stored one and is
// shown once to the Main User who asked for it.
export async function resetPassword(pool, user, id, config) {
  return inTransaction(pool, async (db) => {
    const account = await lockAccount(db, id);
    if (!account) return { ok: false, reason: 'not_found' };
    const refused = needsLiveAccount(account);
    if (refused) return refused;
    const password = generateTemporaryPassword();
    await storeSecret(db, config, account, user, password);
    await recordAudit(db, {
      actorUserId: user.id,
      action: 'COMPANY_PASSWORD_RESET',
      entityType: 'company_accounts',
      entityId: id,
    });
    return { ok: true, data: { password, revealSeconds: REVEAL_SECONDS } };
  });
}

// Reveal: only after the Main User re-enters their own login password. The
// answer says to show the value for 30 seconds; every attempt is logged.
export async function revealPassword(pool, user, id, input, config) {
  const loginPassword = typeof input?.loginPassword === 'string' ? input.loginPassword : '';
  if (!loginPassword) return invalid({ loginPassword: 'Enter your own password to continue.' });

  const credentials = await pool.query(
    'SELECT password_hash FROM user_credentials WHERE user_id = $1',
    [user.id],
  );
  const confirmed = await verifyPassword(credentials.rows[0]?.password_hash, loginPassword);
  if (!confirmed) {
    await recordAudit(pool, {
      actorUserId: user.id,
      action: 'COMPANY_PASSWORD_REVEAL_DENIED',
      entityType: 'company_accounts',
      entityId: id,
    });
    return invalid({ loginPassword: 'That password is not correct.' });
  }

  const found = await pool.query(
    `SELECT ciphertext, iv, auth_tag FROM company_account_secrets WHERE account_id = $1`,
    [id],
  );
  if (found.rows.length === 0) {
    const exists = await findAccount(pool, id);
    if (!exists) return { ok: false, reason: 'not_found' };
    return invalid({ password: 'No temporary password is stored for this account.' });
  }

  const password = decryptSecret(config, id, {
    ciphertext: found.rows[0].ciphertext,
    iv: found.rows[0].iv,
    authTag: found.rows[0].auth_tag,
  });
  await recordAudit(pool, {
    actorUserId: user.id,
    action: 'COMPANY_PASSWORD_REVEAL',
    entityType: 'company_accounts',
    entityId: id,
  });
  return { ok: true, data: { password, revealSeconds: REVEAL_SECONDS } };
}

// "After the employee changes the temporary password, delete the stored one."
export async function clearPassword(pool, user, id) {
  return inTransaction(pool, async (db) => {
    const account = await lockAccount(db, id);
    if (!account) return { ok: false, reason: 'not_found' };
    const { rowCount } = await db.query(
      'DELETE FROM company_account_secrets WHERE account_id = $1',
      [id],
    );
    if (rowCount > 0) {
      await recordAudit(db, {
        actorUserId: user.id,
        action: 'COMPANY_PASSWORD_DELETE',
        entityType: 'company_accounts',
        entityId: id,
        details: { reason: 'employee changed the temporary password' },
      });
    }
    return { ok: true, data: { account: await findAccount(db, id) } };
  });
}

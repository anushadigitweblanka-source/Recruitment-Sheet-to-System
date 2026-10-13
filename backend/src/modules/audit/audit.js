// Field names that must never reach the audit log, at any depth.
const FORBIDDEN_KEY = /password|hash|token|secret|salary/i;

function assertSafe(value, where) {
  if (value === null || typeof value !== 'object') return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key)) {
      throw new Error(`Audit ${where} must not contain "${key}"`);
    }
    assertSafe(nested, where);
  }
}

// Adds one row to the audit log. `db` is the pool, or a client when the audit
// row must be part of a transaction.
//
// action: an upper-case code such as LOGIN_SUCCESS.
// Passwords, hashes, tokens and salaries are refused rather than stored.
export async function recordAudit(
  db,
  {
    actorUserId = null,
    action,
    entityType = null,
    entityId = null,
    oldValues = null,
    newValues = null,
    details = null,
  },
) {
  assertSafe(oldValues, 'old values');
  assertSafe(newValues, 'new values');
  assertSafe(details, 'details');

  await db.query(
    `INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, old_values, new_values, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [actorUserId, action, entityType, entityId, oldValues, newValues, details],
  );
}

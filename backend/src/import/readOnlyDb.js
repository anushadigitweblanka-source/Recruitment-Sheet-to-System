// The import framework's hard safety guard. Every database handle the dry run
// touches goes through this wrapper, which refuses anything but a single
// read-only SELECT. mode is always 'dry-run': there is no other mode until a
// real import is approved, and even then it must be a different, reviewed
// code path - this wrapper never becomes writable.

const READ_ONLY_START = /^\s*(select|with)\b/i;
const FORBIDDEN =
  /\b(insert|update|delete|truncate|alter|drop|create|grant|revoke|copy|merge|vacuum|call|do)\b/i;

export class DryRunWriteError extends Error {
  constructor(sql) {
    super(
      `DRY-RUN SAFETY: refused to run a statement that is not a plain SELECT. ` +
        `The import framework never writes recruitment data. Statement started with: ` +
        `"${String(sql).trim().slice(0, 60)}"`,
    );
    this.name = 'DryRunWriteError';
  }
}

// Wraps a pg pool (or client). Only `query` is exposed, and only for a single
// SELECT (or WITH ... SELECT) statement. Everything else throws before any
// SQL reaches the database.
export function readOnlyDb(pool) {
  return {
    mode: 'dry-run',
    async query(sql, params) {
      const text = String(sql);
      // One statement only: a semicolon may end the statement but nothing may
      // follow it, so a write cannot hide behind a harmless SELECT.
      const body = text.replace(/;\s*$/, '');
      if (!READ_ONLY_START.test(body) || body.includes(';') || FORBIDDEN.test(body)) {
        throw new DryRunWriteError(text);
      }
      return pool.query(text, params);
    },
  };
}

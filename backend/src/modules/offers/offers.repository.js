// All SQL for offers. `db` is the pool, or a client inside a transaction.
//
// Salary functionality pending mentor approval and authorization design.
// No query here reads or writes a salary.

// API field name -> column name, for the fields a user can set.
export const EDITABLE_COLUMNS = {
  positionId: 'position_id',
  offerDate: 'offer_date',
  workMode: 'work_mode',
  location: 'location',
  offerStatus: 'offer_status',
  onboardingDate: 'onboarding_date',
  attended: 'attended',
};

const escapeLike = (text) => text.replace(/[\\%_]/g, '\\$&');

// Dates are read as "YYYY-MM-DD" text, so a calendar date never shifts with
// the time zone of the server.
const OFFER_COLUMNS = `
  o.id AS offer_id, o.position_id AS offer_position_id, op.name AS offer_position_name,
  to_char(o.offer_date, 'YYYY-MM-DD') AS offer_date, o.work_mode, o.location, o.offer_status,
  to_char(o.onboarding_date, 'YYYY-MM-DD') AS onboarding_date, o.attended`;

// The candidates the offer list is about: anyone who already has an offer,
// plus anyone waiting for one (stage "Selected"). "Latest" offer, so this
// keeps working if a second offer per candidate is allowed.
const FROM_CANDIDATES = `
  FROM candidates c
  JOIN pipeline_status ps ON ps.candidate_id = c.id
  JOIN pipeline_stages st ON st.code = ps.current_stage
  LEFT JOIN positions cp ON cp.id = c.position_id
  LEFT JOIN LATERAL (
    SELECT * FROM offers x WHERE x.candidate_id = c.id ORDER BY x.id DESC LIMIT 1
  ) o ON true
  LEFT JOIN positions op ON op.id = o.position_id`;

export async function listOffers(db, filters) {
  const where = [
    filters.waitingOnly
      ? `(o.id IS NULL AND ps.current_stage = 'selected')`
      : `(o.id IS NOT NULL OR ps.current_stage = 'selected')`,
  ];
  const params = [];
  const add = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (filters.search) {
    const pattern = add(`%${escapeLike(filters.search)}%`);
    where.push(`(c.full_name ILIKE ${pattern} OR c.candidate_code ILIKE ${pattern})`);
  }
  if (filters.offerStatus === 'pending') where.push('o.offer_status IS NULL');
  else if (filters.offerStatus) where.push(`o.offer_status = ${add(filters.offerStatus)}`);
  if (filters.onboardingFrom) {
    where.push(`o.onboarding_date >= ${add(filters.onboardingFrom)}::date`);
  }
  if (filters.onboardingTo) where.push(`o.onboarding_date <= ${add(filters.onboardingTo)}::date`);

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const total = await db.query(
    `SELECT count(*)::int AS total ${FROM_CANDIDATES} ${whereSql}`,
    params,
  );

  const limit = add(filters.pageSize);
  const offset = add((filters.page - 1) * filters.pageSize);
  const { rows } = await db.query(
    `SELECT c.id AS candidate_id, c.candidate_code, c.full_name,
            cp.name AS applied_position_name, ps.current_stage, st.name AS stage_name,
            ${OFFER_COLUMNS}
     ${FROM_CANDIDATES}
     ${whereSql}
     ORDER BY o.id DESC NULLS FIRST, c.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );

  return {
    items: rows.map((row) => ({
      candidate: {
        id: Number(row.candidate_id),
        candidateCode: row.candidate_code,
        fullName: row.full_name,
        // The position applied for, shown while there is no offer yet.
        position: row.applied_position_name ?? null,
        stage: { code: row.current_stage, name: row.stage_name },
      },
      offer: row.offer_id
        ? {
            id: Number(row.offer_id),
            position: row.offer_position_name,
            offerDate: row.offer_date,
            workMode: row.work_mode,
            location: row.location,
            offerStatus: row.offer_status,
            onboardingDate: row.onboarding_date,
            attended: row.attended,
          }
        : null,
    })),
    total: total.rows[0].total,
  };
}

// One offer with its candidate.
export async function findOffer(db, id) {
  const { rows } = await db.query(
    `SELECT c.id AS candidate_id, c.candidate_code, c.full_name, c.phone,
            cp.name AS applied_position_name, ps.current_stage, st.name AS stage_name,
            ${OFFER_COLUMNS}, o.updated_at, uu.full_name AS updated_by_name
       FROM offers o
       JOIN candidates c ON c.id = o.candidate_id
       JOIN pipeline_status ps ON ps.candidate_id = c.id
       JOIN pipeline_stages st ON st.code = ps.current_stage
       JOIN positions op ON op.id = o.position_id
       LEFT JOIN positions cp ON cp.id = c.position_id
       LEFT JOIN users uu ON uu.id = o.updated_by
      WHERE o.id = $1`,
    [id],
  );
  if (rows.length === 0) return null;
  const row = rows[0];

  return {
    candidate: {
      id: Number(row.candidate_id),
      candidateCode: row.candidate_code,
      fullName: row.full_name,
      phone: row.phone,
      position: row.applied_position_name ?? null,
      stage: { code: row.current_stage, name: row.stage_name },
    },
    offer: {
      id: Number(row.offer_id),
      positionId: Number(row.offer_position_id),
      position: row.offer_position_name,
      offerDate: row.offer_date,
      workMode: row.work_mode,
      location: row.location,
      offerStatus: row.offer_status,
      onboardingDate: row.onboarding_date,
      attended: row.attended,
      updatedAt: row.updated_at,
      updatedBy: row.updated_by_name,
    },
  };
}

export async function offerIdForCandidate(db, candidateId) {
  const { rows } = await db.query(
    'SELECT id FROM offers WHERE candidate_id = $1 ORDER BY id DESC LIMIT 1',
    [candidateId],
  );
  return rows[0] ? Number(rows[0].id) : null;
}

export async function findPosition(db, id) {
  const { rows } = await db.query('SELECT id, is_active FROM positions WHERE id = $1', [id]);
  return rows[0] ? { id: Number(rows[0].id), isActive: rows[0].is_active } : null;
}

export async function insertOffer(db, candidateId, values, userId) {
  const names = Object.keys(EDITABLE_COLUMNS);
  const { rows } = await db.query(
    `INSERT INTO offers (candidate_id, ${names.map((n) => EDITABLE_COLUMNS[n]).join(', ')}, created_by, updated_by)
     VALUES ($1, ${names.map((_, i) => `$${i + 2}`).join(', ')}, $${names.length + 2}, $${names.length + 2})
     RETURNING id`,
    [candidateId, ...names.map((n) => values[n]), userId],
  );
  return Number(rows[0].id);
}

export async function updateOffer(db, id, changes, userId) {
  const names = Object.keys(changes);
  await db.query(
    `UPDATE offers
        SET ${names.map((n, i) => `${EDITABLE_COLUMNS[n]} = $${i + 1}`).join(', ')},
            updated_at = now(), updated_by = $${names.length + 1}
      WHERE id = $${names.length + 2}`,
    [...names.map((n) => changes[n]), userId, id],
  );
}

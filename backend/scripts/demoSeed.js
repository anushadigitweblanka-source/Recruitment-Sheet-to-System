// Fictional demonstration data for a SEPARATE hosted demo database. Every name,
// address and number here is made up, and nothing is read from or copied out of
// the real database.
//
// The data is created through the application's own API (run inside this
// process), so every record passes the same rules the real application
// enforces. The pipeline stages, offers, employees and reminders therefore all
// agree with each other.
//
// This file only defines the seed. The command-line wrapper
// (seed-demo-data.js) holds the safety guards; the tests run it on a throwaway
// schema.
import { randomBytes } from 'node:crypto';
import { createApp } from '../src/app.js';
import { hashPassword } from '../src/modules/auth/passwords.js';

export const DEMO_DATABASE = 'recruitment_demo_dev';
export const DEMO_HR_EMAIL = 'hr.demo@example.test';
export const DEMO_MANAGER_EMAIL = 'manager.demo@example.test';
export const SEEDER_EMAIL = 'demo.seeder@example.test';
export const SUPERVISOR_ROLE = 'hr';

const DAY = 24 * 60 * 60 * 1000;
const inDays = (days) => new Date(Date.now() + days * DAY);
const isoDay = (date) => date.toISOString().slice(0, 10);

// Counts the real-data tables the seed must find empty. A table that is missing
// means the migrations have not been applied to this database.
export async function countExisting(pool) {
  const count = async (table) =>
    (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;
  return {
    candidates: await count('candidates'),
    employees: await count('employees'),
    offers: await count('offers'),
    interviews: await count('interviews'),
    historicalRecords: await count('historical_interview_records'),
    users: await count('users'),
  };
}

// What the seed would create, for the dry run.
export const PLAN = [
  '2 positions, 2 sources, 2 team leads, 2 fictional reminder addresses',
  '9 fictional candidates (D-0001 to D-0009) across the whole pipeline: Applied, Not Selected after the phone call,',
  '  Interview Scheduled, Offer Sent, Offer Accepted, Rejected, On Hold, and two Joined employees',
  '  (one in Evaluation, one that passed Evaluation and is in Probation)',
  '1 restricted supervisor account (HR role: no salary, no administration)',
];

export async function seedDemoData({ pool, config, supervisor, log = () => {} }) {
  // 1. A one-use seeding account. Its password exists only in memory, is never
  //    printed, and the account is switched off again at the end.
  const seederPassword = randomBytes(24).toString('base64url');
  const role = await pool.query(`SELECT id FROM roles WHERE code = 'main_user'`);
  if (role.rowCount === 0) throw new Error('Role main_user not found. Apply the migrations first.');
  const seeder = await pool.query(
    `INSERT INTO users (email, full_name, role_id) VALUES ($1, 'Demo Seeder', $2) RETURNING id`,
    [SEEDER_EMAIL, role.rows[0].id],
  );
  const seederId = Number(seeder.rows[0].id);
  await pool.query('INSERT INTO user_credentials (user_id, password_hash) VALUES ($1, $2)', [
    seederId,
    await hashPassword(seederPassword),
  ]);

  const server = createApp({ config, pool }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';

  async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Cookie: cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, res };
  }
  const must = async (what, promise, ok = [200, 201]) => {
    const result = await promise;
    if (!ok.includes(result.status)) {
      throw new Error(
        `Seed step "${what}" failed with ${result.status}: ${JSON.stringify(result.body)}`,
      );
    }
    return result;
  };

  try {
    const login = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: SEEDER_EMAIL, password: seederPassword }),
    });
    if (login.status !== 200) throw new Error('The seeding account could not sign in.');
    cookie = login.headers.get('set-cookie').split(';')[0];

    // 2. Reference data.
    const lookup = async (list, name) =>
      (await must(`${list} ${name}`, api(`/lookups/${list}`, { method: 'POST', body: { name } })))
        .body.item;
    const webDev = await lookup('positions', 'Demo Web Developer');
    const qaIntern = await lookup('positions', 'Demo QA Intern');
    const jobBoard = await lookup('sources', 'Demo Job Board');
    const referral = await lookup('sources', 'Demo Referral');
    for (const [position, name, email] of [
      [webDev, 'Demo Lead One', 'lead.one.demo@example.test'],
      [qaIntern, 'Demo Lead Two', 'lead.two.demo@example.test'],
    ]) {
      await must(
        `team lead ${name}`,
        api('/admin/team-leads', {
          method: 'POST',
          body: { positionId: position.id, teamName: 'Demo Team', name, email },
        }),
      );
    }
    for (const [key, value] of [
      ['reminder_hr_emails', DEMO_HR_EMAIL],
      ['reminder_manager_emails', DEMO_MANAGER_EMAIL],
      ['interview_venue', 'Demo Office, Floor 2'],
    ]) {
      await must(
        `setting ${key}`,
        api(`/admin/settings/${key}`, { method: 'PATCH', body: { value } }),
      );
    }
    log('Reference data created.');

    // 3. Candidates through the pipeline.
    let n = 0;
    const candidate = async (fullName, position, source) => {
      n += 1;
      const code = `D-${String(n).padStart(4, '0')}`;
      const res = await must(
        `candidate ${code}`,
        api('/candidates', {
          method: 'POST',
          body: {
            candidateCode: code,
            fullName,
            phone: `0770000${String(n).padStart(3, '0')}`,
            email: `candidate.${String(n).padStart(4, '0')}@example.test`,
            positionId: position.id,
            sourceId: source.id,
          },
        }),
      );
      return res.body.candidate;
    };
    const phone = (c, extra) =>
      must(
        `phone interview ${c.candidateCode}`,
        api('/phone-interviews', {
          method: 'POST',
          body: { candidateId: c.id, called: true, ...extra },
        }),
      );
    const selectedByPhone = (c, days) =>
      phone(c, { result: 'selected', interviewAt: inDays(days).toISOString() });
    const interview = (c, days, extra) =>
      must(
        `interview ${c.candidateCode}`,
        api('/interviews', {
          method: 'POST',
          body: { candidateId: c.id, scheduledAt: inDays(days).toISOString(), ...extra },
        }),
      );
    const scores = {
      attendance: 'attended',
      interviewerName: 'Demo Interviewer',
      scoreTechnical: 8,
      scoreAi: 7,
      scoreCommunication: 9,
      scoreConfidence: 6,
      scoreCultureFit: 10,
    };
    const selectedInterview = async (c) => {
      await selectedByPhone(c, 3);
      await interview(c, 2, { ...scores, recommendation: 'Recommended', decision: 'selected' });
    };
    // A selected candidate already has an offer row; the details are added to it.
    const offerRow = async (c) =>
      Number(
        (await pool.query('SELECT id FROM offers WHERE candidate_id = $1', [c.id])).rows[0].id,
      );
    const updateOffer = async (c, fields) =>
      must(
        `offer ${c.candidateCode}`,
        api(`/offers/${await offerRow(c)}`, { method: 'PATCH', body: fields }),
      );

    await candidate('Demo Applicant Alpha', webDev, jobBoard); // Applied only

    const beta = await candidate('Demo Applicant Beta', webDev, referral);
    await phone(beta, {
      result: 'not_selected',
      rejectReason: 'Fictional: not a fit for the demo role',
    });

    await selectedByPhone(await candidate('Demo Applicant Gamma', qaIntern, jobBoard), 3); // Interview Scheduled

    const delta = await candidate('Demo Applicant Delta', webDev, jobBoard);
    await selectedInterview(delta);
    await updateOffer(delta, { offerStatus: 'sent', offerDate: isoDay(inDays(0)) }); // Offer Sent

    const epsilon = await candidate('Demo Applicant Epsilon', qaIntern, referral);
    await selectedInterview(epsilon);
    await updateOffer(epsilon, { offerStatus: 'accepted', onboardingDate: isoDay(inDays(10)) }); // Offer Accepted

    const zeta = await candidate('Demo Employee Zeta', webDev, jobBoard);
    await selectedInterview(zeta);
    await updateOffer(zeta, { offerStatus: 'accepted', onboardingDate: isoDay(inDays(-3)) });
    await updateOffer(zeta, { attended: true }); // Joined: Evaluation

    const eta = await candidate('Demo Employee Eta', qaIntern, referral);
    await selectedInterview(eta);
    await updateOffer(eta, { offerStatus: 'accepted', onboardingDate: isoDay(inDays(-9)) });
    await updateOffer(eta, { attended: true });
    const etaEmployee = Number(
      (await pool.query('SELECT id FROM employees WHERE candidate_id = $1', [eta.id])).rows[0].id,
    );
    await must(
      'evaluation pass',
      api(`/employees/${etaEmployee}/decision`, { method: 'POST', body: { result: 'pass' } }),
    ); // Probation

    const theta = await candidate('Demo Applicant Theta', webDev, referral);
    await selectedByPhone(theta, 3);
    await interview(theta, 2, {
      ...scores,
      recommendation: 'Not Recommended',
      decision: 'not_selected',
      rejectReason: 'Fictional: scores below the demo threshold',
    }); // Rejected

    const iota = await candidate('Demo Applicant Iota', qaIntern, jobBoard);
    await selectedByPhone(iota, 3);
    await interview(iota, 2, {
      ...scores,
      recommendation: 'Consider',
      decision: 'on_hold',
      holdReason: 'Fictional: waiting for a second round',
      nextFollowupDate: isoDay(inDays(14)),
    }); // On Hold
    log('Nine fictional candidates created.');

    // 4. The restricted supervisor account (HR: no salary, no administration).
    const roles = await must('roles', api('/admin/users/roles'));
    const hrRole = (roles.body.items ?? roles.body.roles ?? []).find(
      (r) => r.code === SUPERVISOR_ROLE,
    );
    if (!hrRole) throw new Error(`Role ${SUPERVISOR_ROLE} not found.`);
    await must(
      'supervisor account',
      api('/admin/users', {
        method: 'POST',
        body: {
          fullName: supervisor.fullName,
          email: supervisor.email,
          roleId: hrRole.id,
          password: supervisor.password,
        },
      }),
    );
    log('Supervisor account created.');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    // The one-use account is switched off and signed out; it cannot be used again.
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [seederId]);
    await pool.query('DELETE FROM user_sessions WHERE user_id = $1', [seederId]);
  }
}

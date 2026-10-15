import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../src/app.js';
import { createTestDatabase, createTestUser } from './testDb.js';

// A running application on a throwaway schema, with small helpers to drive
// the real routes. Every name, address and amount used with it is made up.

const DAY = 24 * 60 * 60 * 1000;

export const inDays = (days) => new Date(Date.now() + days * DAY);
export const isoDay = (date) => date.toISOString().slice(0, 10);

export async function startHarness({ config = {} } = {}) {
  const db = await createTestDatabase();
  const appConfig = { ...db.config, ...config };
  const server = createApp({ config: appConfig, pool: db.pool }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let nextCode = 1;

  async function raw(path, { method = 'GET', body, cookie, headers = {}, rawBody } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: rawBody ?? (body ? JSON.stringify(body) : undefined),
    });
    return res;
  }

  async function api(path, options = {}) {
    const res = await raw(`/api${path}`, options);
    const text = await res.text();
    let parsed;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed };
  }

  async function signedIn(options) {
    const user = await createTestUser(db.pool, options);
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    return { ...user, cookie: res.headers.get('set-cookie').split(';')[0] };
  }

  const admin = await signedIn();
  const asAdmin = { cookie: admin.cookie };

  async function lookup(list, name) {
    const res = await api(`/lookups/${list}`, { method: 'POST', ...asAdmin, body: { name } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.item;
  }

  async function setSetting(key, value) {
    const res = await api(`/admin/settings/${key}`, {
      method: 'PATCH',
      ...asAdmin,
      body: { value },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  }

  async function newCandidate(overrides = {}) {
    const n = nextCode;
    nextCode += 1;
    const res = await api('/candidates', {
      method: 'POST',
      ...asAdmin,
      body: {
        candidateCode: `S11-${String(n).padStart(4, '0')}`,
        fullName: `Stage Eleven Sample ${n}`,
        phone: `07600${String(n).padStart(5, '0')}`,
        email: `candidate.${n}.${randomBytes(3).toString('hex')}@example.test`,
        ...overrides,
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.candidate;
  }

  // Phone interview selected, with a direct interview slot.
  async function phoneSelected(candidate, interviewAt = inDays(3)) {
    const res = await api('/phone-interviews', {
      method: 'POST',
      ...asAdmin,
      body: {
        candidateId: candidate.id,
        called: true,
        result: 'selected',
        interviewAt: interviewAt.toISOString(),
      },
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res;
  }

  async function directInterview(candidate, scheduledAt = inDays(3), extra = {}) {
    return api('/interviews', {
      method: 'POST',
      ...asAdmin,
      body: { candidateId: candidate.id, scheduledAt: scheduledAt.toISOString(), ...extra },
    });
  }

  // Through the phone interview, an attended and selected direct interview,
  // and an accepted offer with a joining date.
  async function offered(candidate, { positionId, onboardingDate = isoDay(inDays(10)) } = {}) {
    await phoneSelected(candidate);
    const interview = await directInterview(candidate, inDays(2), {
      attendance: 'attended',
      scoreTechnical: 8,
      scoreAi: 7,
      scoreCommunication: 9,
      scoreConfidence: 6,
      scoreCultureFit: 10,
      decision: 'selected',
    });
    assert.equal(interview.status, 201, JSON.stringify(interview.body));
    const fields = { offerStatus: 'accepted', onboardingDate };
    let offer = await api('/offers', {
      method: 'POST',
      ...asAdmin,
      body: { candidateId: candidate.id, positionId, ...fields },
    });
    // A selected candidate with an applied position already has an offer row
    // (created automatically); the details are then added to it.
    if (offer.status === 409) {
      offer = await api(`/offers/${offer.body.offerId}`, {
        method: 'PATCH',
        ...asAdmin,
        body: fields,
      });
      assert.equal(offer.status, 200, JSON.stringify(offer.body));
    } else {
      assert.equal(offer.status, 201, JSON.stringify(offer.body));
    }
    return offer.body.offer;
  }

  async function joined(candidate, options) {
    const offer = await offered(candidate, options);
    const res = await api(`/offers/${offer.id}`, {
      method: 'PATCH',
      ...asAdmin,
      body: { attended: true },
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { rows } = await db.pool.query('SELECT id FROM employees WHERE candidate_id = $1', [
      candidate.id,
    ]);
    return { offer, employeeId: Number(rows[0].id) };
  }

  const query = async (sql, params = []) => (await db.pool.query(sql, params)).rows;

  return {
    db,
    config: appConfig,
    baseUrl,
    api,
    raw,
    signedIn,
    admin,
    asAdmin,
    lookup,
    setSetting,
    newCandidate,
    phoneSelected,
    directInterview,
    offered,
    joined,
    query,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      await db.cleanup();
    },
  };
}

export async function auditActions(h, entityType, entityId) {
  const rows = await h.query(
    'SELECT action FROM audit_log WHERE entity_type = $1 AND entity_id = $2 ORDER BY id',
    [entityType, entityId],
  );
  return rows.map((row) => row.action);
}

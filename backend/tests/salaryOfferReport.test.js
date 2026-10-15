import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { inDays, isoDay, startHarness } from './helpers/harness.js';

// The Salary and Offer report: offered salary per position and offer status,
// for the Main User only, audited on every view and export. Every candidate
// and amount below is made up.

const A1 = 123456.78;
const A2 = 234567.89;
const A_SENT = 345678.9;

let h;
let hr;
let teamLead;
let intern;
let posA;
let posB;
let candidates;

async function setSalary(candidate, amount) {
  const res = await h.api(`/salary/${candidate.id}`, {
    method: 'PUT',
    ...h.asAdmin,
    body: { salaryLkr: amount },
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

before(async () => {
  h = await startHarness();
  hr = await h.signedIn({ roleCode: 'hr' });
  teamLead = await h.signedIn({ roleCode: 'team_lead' });
  intern = await h.signedIn({ roleCode: 'intern_dev' });
  posA = await h.lookup('positions', 'Offer Position A');
  posB = await h.lookup('positions', 'Offer Position B');

  const make = async (fullName, position) => {
    const candidate = await h.newCandidate({ positionId: position.id, fullName });
    await h.offered(candidate, { positionId: position.id, onboardingDate: isoDay(inDays(14)) });
    return candidate;
  };
  candidates = {
    a1: await make('Report Sample A1', posA),
    a2: await make('Report Sample A2', posA),
    aSent: await make('Report Sample ASent', posA),
    b1: await make('Report Sample B1', posB),
  };

  await setSalary(candidates.a1, A1);
  await setSalary(candidates.a2, A2);
  await setSalary(candidates.aSent, A_SENT);
  // b1 has an offer but no salary entered yet.

  // Offer dates and one offer that is only Sent.
  const setOffer = (candidate, date, status) =>
    h.query(
      `UPDATE offers SET offer_date = $1, offer_status = $2,
              attended = NULL, onboarding_date = CASE WHEN $2 = 'accepted' THEN onboarding_date END
        WHERE candidate_id = $3`,
      [date, status, candidate.id],
    );
  await setOffer(candidates.a1, '2026-10-01', 'accepted');
  await setOffer(candidates.a2, '2026-10-20', 'accepted');
  await setOffer(candidates.aSent, '2026-10-10', 'sent');
  await setOffer(candidates.b1, '2026-10-05', 'accepted');
});

after(async () => {
  await h.stop();
});

const view = (query = '', who = h.asAdmin) => h.api(`/reports/salary-offers${query}`, who);
const exportAs = (format, query = '', who = h.asAdmin) =>
  h.raw(`/api/reports/salary-offers/export?format=${format}${query}`, who);

describe('report content and filters', () => {
  test('shows offered salary per position and offer status from the database', async () => {
    const res = await view();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.total, 4);

    const group = (position, status) =>
      res.body.groups.find((g) => g.position === position && g.offerStatus === status);

    assert.deepEqual(group('Offer Position A', 'accepted'), {
      position: 'Offer Position A',
      offerStatus: 'accepted',
      offers: 2,
      priced: 2,
      lowest: A1,
      average: 179012.34, // (123456.78 + 234567.89) / 2, rounded to 2 decimals
      highest: A2,
      total: 358024.67,
    });
    assert.equal(group('Offer Position A', 'sent').highest, A_SENT);
    const b = group('Offer Position B', 'accepted');
    assert.equal(b.offers, 1);
    assert.equal(b.priced, 0, 'an offer without a salary is not priced');
    assert.equal(b.average, null);

    const row = res.body.items.find((i) => i.candidateCode === candidates.a1.candidateCode);
    assert.equal(row.salaryLkr, A1);
    assert.equal(row.position, 'Offer Position A');
    assert.equal(row.offerStatus, 'accepted');
    assert.equal(row.offerDate, '2026-10-01');
    const noSalary = res.body.items.find((i) => i.candidateCode === candidates.b1.candidateCode);
    assert.equal(noSalary.salaryLkr, null);
  });

  test('filters by position, offer status and offer date, and counts only what matches', async () => {
    const byPosition = await view(`?positionId=${posB.id}`);
    assert.equal(byPosition.body.total, 1);
    assert.deepEqual(
      byPosition.body.items.map((i) => i.position),
      ['Offer Position B'],
    );

    const sent = await view('?offerStatus=sent');
    assert.deepEqual(
      sent.body.items.map((i) => i.fullName),
      ['Report Sample ASent'],
    );

    const dated = await view('?from=2026-10-05&to=2026-10-10');
    assert.deepEqual(dated.body.items.map((i) => i.fullName).sort(), [
      'Report Sample ASent',
      'Report Sample B1',
    ]);
    assert.equal(
      dated.body.groups.reduce((n, g) => n + g.offers, 0),
      2,
    );

    const none = await view('?positionId=999999');
    assert.equal(none.body.total, 0);
    assert.deepEqual(none.body.items, []);

    // Malformed filters are ignored, not an error.
    const loose = await view('?positionId=abc&offerStatus=nonsense&from=yesterday');
    assert.equal(loose.body.total, 4);
  });

  test('pages the list while the position figures cover every matching offer', async () => {
    const page = await view('?pageSize=2&page=2');
    assert.equal(page.body.items.length, 2);
    assert.equal(page.body.total, 4);
    assert.equal(
      page.body.groups.reduce((n, g) => n + g.offers, 0),
      4,
    );
  });
});

describe('who may reach it', () => {
  test('HR, Team Lead, Intern / Dev and signed-out callers are refused, on screen and in every export', async () => {
    for (const who of [hr, teamLead, intern, null]) {
      const options = who ? { cookie: who.cookie } : {};
      const expected = who ? 403 : 401;
      assert.equal((await view('', options)).status, expected);
      for (const format of ['xlsx', 'csv', 'pdf']) {
        const res = await exportAs(format, '', options);
        assert.equal(res.status, expected, `${format} for ${who?.email ?? 'signed out'}`);
        const text = await res.text();
        assert.ok(!text.includes('123456'), 'no amount in the refusal');
      }
    }
  });

  test('the shared export route cannot be used to reach it either', async () => {
    // "salary-offers" is not one of the shared reports; HR gets the same
    // refusal on its own route, and the shared names stay salary-free.
    const res = await h.raw('/api/reports/salary-offer/export?format=csv', { cookie: hr.cookie });
    assert.equal(res.status, 404);
  });

  test('the other reports stay open to HR and contain no salary', async () => {
    for (const path of ['/reports/candidate-status', '/reports/positions', '/offers']) {
      const res = await h.api(path, { cookie: hr.cookie });
      assert.equal(res.status, 200, path);
      const text = JSON.stringify(res.body);
      for (const amount of ['123456', '234567', '345678']) {
        assert.ok(!text.includes(amount), `${path} must not hold ${amount}`);
      }
      assert.doesNotMatch(text, /salary/i);
    }
    for (const report of ['candidate-status', 'positions', 'onboarding']) {
      const res = await h.raw(`/api/reports/${report}/export?format=csv`, { cookie: hr.cookie });
      assert.equal(res.status, 200);
      const text = await res.text();
      assert.doesNotMatch(text, /123456|234567|345678|salary/i);
    }
  });
});

describe('exports', () => {
  test('CSV holds the same filtered rows and amounts as the screen', async () => {
    const res = await exportAs('csv', `&positionId=${posA.id}&offerStatus=accepted`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.headers.get('content-disposition'), /salary-offers-\d{4}-\d{2}-\d{2}\.csv/);
    const bytes = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 byte order mark');
    const text = bytes.toString('utf8');
    const lines = text.slice(1).trim().split('\r\n');
    assert.equal(
      lines[0],
      'Candidate ID,Name,Position,Offer Status,Offer Date,Offered Salary (LKR)',
    );
    assert.equal(lines.length, 3);
    assert.ok(text.includes('123456.78'));
    assert.ok(text.includes('234567.89'));
    assert.ok(!text.includes('345678.90'), 'the Sent offer is filtered out');
    assert.ok(!text.includes('Offer Position B'));
  });

  test('CSV marks an offer without a salary as Not set', async () => {
    const res = await exportAs('csv', `&positionId=${posB.id}`);
    const text = await res.text();
    assert.match(text, /Report Sample B1,Offer Position B,Accepted,05 Oct 2026,Not set/);
  });

  test('Excel and PDF are real files with the right content types', async () => {
    const xlsx = await exportAs('xlsx');
    assert.equal(xlsx.status, 200);
    assert.match(xlsx.headers.get('content-type'), /spreadsheetml\.sheet/);
    const xlsxBytes = Buffer.from(await xlsx.arrayBuffer());
    assert.equal(xlsxBytes.subarray(0, 2).toString(), 'PK');

    const pdf = await exportAs('pdf');
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    const pdfBytes = Buffer.from(await pdf.arrayBuffer());
    assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');
  });

  test('an unknown format is refused', async () => {
    assert.equal((await exportAs('docx')).status, 404);
  });
});

describe('audit', () => {
  test('every view and export is audited with the person and filters, never an amount', async () => {
    // The audit log is append-only, so earlier rows (from the tests above) stay.
    const [{ top }] = await h.query(
      `SELECT COALESCE(max(id), 0) AS top FROM audit_log WHERE action LIKE 'SALARY_REPORT%'`,
    );

    await view(`?positionId=${posA.id}`);
    await exportAs('csv', `&offerStatus=accepted`);
    await exportAs('pdf');
    // Refused attempts must not create report rows.
    await view('', { cookie: hr.cookie });
    await exportAs('csv', '', { cookie: hr.cookie });

    const rows = await h.query(
      `SELECT action, actor_user_id, entity_type, entity_id, details
         FROM audit_log WHERE action LIKE 'SALARY_REPORT%' AND id > $1 ORDER BY id`,
      [top],
    );
    assert.deepEqual(
      rows.map((r) => r.action),
      ['SALARY_REPORT_VIEW', 'SALARY_REPORT_EXPORT', 'SALARY_REPORT_EXPORT'],
    );
    for (const row of rows) {
      assert.equal(Number(row.actor_user_id), h.admin.id);
      assert.equal(row.entity_type, 'report');
      assert.equal(row.details.report, 'salary-offers');
    }
    assert.deepEqual(
      rows.map((r) => r.details.format ?? null),
      [null, 'csv', 'pdf'],
    );
    assert.equal(rows[0].details.filters.positionId, posA.id);
    assert.equal(rows[1].details.filters.offerStatus, 'accepted');

    const everything = JSON.stringify(rows);
    assert.doesNotMatch(everything, /123456|234567|345678|salaryLkr/);
  });
});

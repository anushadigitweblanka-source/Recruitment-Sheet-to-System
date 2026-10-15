import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  JUNIOR_BASES,
  addDays,
  addMonths,
  evaluationEnd,
  isRealDate,
  juniorPhaseEnd,
  monthsPhaseEnd,
  nextPhaseStart,
} from '../src/modules/employees/lifecycleDates.js';

// The lifecycle date rules of the task guide, section 3, with its own worked
// example. The Junior counting rule is NOT decided by these tests: both
// readings are checked and neither is wired into the application.

const JOIN = '2026-11-02';

function phases(join = JOIN) {
  const evaluationStart = join;
  const evalEnd = evaluationEnd(join, 7);
  const probationStart = nextPhaseStart(evalEnd);
  const probationEnd = monthsPhaseEnd(probationStart, 3);
  const juniorStart = nextPhaseStart(probationEnd);
  return { evaluationStart, evalEnd, probationStart, probationEnd, juniorStart };
}

describe('the guide worked example (join 2 Nov 2026)', () => {
  test('evaluation runs 2-8 Nov 2026', () => {
    const p = phases();
    assert.equal(p.evaluationStart, '2026-11-02');
    assert.equal(p.evalEnd, '2026-11-08');
  });

  test('probation runs 9 Nov 2026 to 8 Feb 2027', () => {
    const p = phases();
    assert.equal(p.probationStart, '2026-11-09');
    assert.equal(p.probationEnd, '2027-02-08');
  });

  test('junior starts 9 Feb 2027', () => {
    assert.equal(phases().juniorStart, '2027-02-09');
  });

  test('counting 9 months after probation reproduces the guide: ends 8 Nov 2027, Senior 9 Nov 2027', () => {
    const { juniorStart } = phases();
    const end = juniorPhaseEnd({
      juniorStart,
      joinDate: JOIN,
      months: 9,
      basis: 'after_probation',
    });
    assert.equal(end, '2027-11-08');
    assert.equal(nextPhaseStart(end), '2027-11-09');
  });

  test('counting 9 months from joining gives a shorter junior phase (the guide’s other reading)', () => {
    const { juniorStart } = phases();
    const end = juniorPhaseEnd({ juniorStart, joinDate: JOIN, months: 9, basis: 'from_joining' });
    assert.equal(end, '2027-08-01');
    const days = (Date.parse(end) - Date.parse(juniorStart)) / 86_400_000 + 1;
    assert.equal(days, 174, 'about six months after probation, as the guide says');
  });
});

describe('month arithmetic', () => {
  test('EDATE stops at the end of a shorter month', () => {
    assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
    assert.equal(addMonths('2027-12-31', 2), '2028-02-29'); // leap year
    assert.equal(addMonths('2026-08-31', 3), '2026-11-30');
  });

  test('a join on the 31st still yields consistent phase dates', () => {
    const p = phases('2026-08-31');
    assert.equal(p.evalEnd, '2026-09-06');
    assert.equal(p.probationStart, '2026-09-07');
    assert.equal(p.probationEnd, '2026-12-06');
    assert.equal(p.juniorStart, '2026-12-07');
    assert.equal(
      juniorPhaseEnd({
        juniorStart: p.juniorStart,
        joinDate: '2026-08-31',
        months: 9,
        basis: 'after_probation',
      }),
      '2027-09-06',
    );
  });

  test('year ends and leap days are handled', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(isRealDate('2027-02-29'), false);
    assert.equal(isRealDate('2028-02-29'), true);
  });
});

describe('junior end across month ends and leap years (after probation)', () => {
  const end = (juniorStart, months = 9) =>
    juniorPhaseEnd({ juniorStart, joinDate: JOIN, months, basis: 'after_probation' });

  test('the end is the day before the same day nine months later', () => {
    assert.equal(end('2027-02-09'), '2027-11-08');
    assert.equal(end('2026-12-07'), '2027-09-06');
  });

  test('a start on the 31st clamps to the end of a shorter month', () => {
    assert.equal(end('2027-05-31'), '2028-02-28'); // 31 May + 9 months = 29 Feb 2028, minus a day
    assert.equal(end('2026-05-31', 9), '2027-02-27'); // 28 Feb 2027 minus a day
  });

  test('a leap day is respected', () => {
    assert.equal(end('2027-06-01'), '2028-02-29');
    assert.equal(end('2027-05-30'), '2028-02-28');
    assert.equal(end('2028-02-29', 12), '2029-02-27'); // 28 Feb 2029 minus a day
  });

  test('a start on 1 March needs no clamping', () => {
    assert.equal(end('2027-03-01', 12), '2028-02-29');
  });
});

describe('juniorPhaseEnd safety', () => {
  test('refuses an unknown basis instead of choosing one', () => {
    assert.throws(
      () => juniorPhaseEnd({ juniorStart: '2027-02-09', joinDate: JOIN, months: 9, basis: '' }),
      /Unknown junior basis/,
    );
    assert.throws(
      () =>
        juniorPhaseEnd({ juniorStart: '2027-02-09', joinDate: JOIN, months: 9, basis: undefined }),
      /Unknown junior basis/,
    );
    assert.deepEqual(JUNIOR_BASES, ['after_probation', 'from_joining']);
  });

  test('a from-joining end that is not after the junior start is not invented', () => {
    // Junior would start after the 9 months from joining have already passed.
    const end = juniorPhaseEnd({
      juniorStart: '2027-09-01',
      joinDate: JOIN,
      months: 9,
      basis: 'from_joining',
    });
    assert.equal(end, null);
  });

  test('uses the configured number of months, not a fixed 9', () => {
    assert.equal(
      juniorPhaseEnd({
        juniorStart: '2027-02-09',
        joinDate: JOIN,
        months: 6,
        basis: 'after_probation',
      }),
      '2027-08-08',
    );
  });
});

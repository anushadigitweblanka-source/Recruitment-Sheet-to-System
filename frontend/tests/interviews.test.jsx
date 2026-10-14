// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.jsx';
import { AuthContext } from '../src/auth/AuthContext.jsx';

// Every name in this file is made up.

const SIGNED_IN = {
  status: 'authenticated',
  user: {
    id: 1,
    email: 'test.user@example.test',
    fullName: 'Test User',
    role: { code: 'main_user', name: 'Main User' },
    permissions: ['candidates.view', 'interviews.manage'],
  },
  login: async () => ({ ok: true }),
  logout: async () => ({ ok: true }),
};

const STAGE_NAMES = {
  interview_scheduled: 'Interview Scheduled',
  interviewed: 'Interviewed',
  not_attended: 'Not Attended',
  selected: 'Selected',
  rejected: 'Rejected',
  on_hold: 'On Hold',
};
const SLOT = '2026-11-02T04:30:00.000Z'; // 10:00 in Colombo
const SCORE_NAMES = [
  'scoreTechnical',
  'scoreAi',
  'scoreCommunication',
  'scoreConfidence',
  'scoreCultureFit',
];
const SCORE_LABELS = ['Technical', 'AI', 'Communication', 'Confidence', 'Culture Fit'];

const candidate = (id, stage = 'interview_scheduled') => ({
  id,
  candidateCode: `TEST-${String(id).padStart(3, '0')}`,
  fullName: `Sample Person ${id}`,
  phone: `07100000${String(id).padStart(2, '0')}`,
  position: null,
  stage: { code: stage, name: STAGE_NAMES[stage] },
});

const interviewRecord = (id, overrides = {}) => ({
  id,
  scheduledAt: SLOT,
  attendance: null,
  interviewerName: null,
  scoreTechnical: null,
  scoreAi: null,
  scoreCommunication: null,
  scoreConfidence: null,
  scoreCultureFit: null,
  totalScore: null,
  recommendation: null,
  decision: null,
  remarks: null,
  updatedAt: '2026-10-13T06:00:00.000Z',
  updatedBy: 'Test User',
  ...overrides,
});

const SCORED = {
  attendance: 'attended',
  scoreTechnical: 8,
  scoreAi: 7,
  scoreCommunication: 9,
  scoreConfidence: 6,
  scoreCultureFit: 10,
  totalScore: 40,
};

// An entry is one candidate with (or without) an interview.
const entry = (id, interview = null, stage = 'interview_scheduled', extra = {}) => ({
  candidate: candidate(id, stage),
  interview,
  holdReason: null,
  nextFollowupDate: null,
  rejectReason: null,
  ...extra,
});

// A pretend backend that keeps interviews in memory and applies the same
// total and stage rules as the real one.
function fakeBackend({ entries = [], listFails = 0, hang = false, refuse = null } = {}) {
  const state = { entries: entries.map((e) => structuredClone(e)), calls: [], listFails };
  const json = (status, data) => ({ ok: status < 400, status, json: async () => data });

  function save(found, body) {
    if (refuse) return json(422, { error: 'validation_failed', message: 'x', fields: refuse });
    const scores = SCORE_NAMES.map((name) => body[name]);
    const complete = scores.every((score) => Number.isInteger(score));
    found.interview = interviewRecord(found.interview?.id ?? found.candidate.id + 700, {
      scheduledAt: new Date(body.scheduledAt).toISOString(),
      attendance: body.attendance,
      interviewerName: body.interviewerName || null,
      ...Object.fromEntries(SCORE_NAMES.map((name) => [name, body[name]])),
      totalScore: complete ? scores.reduce((sum, score) => sum + score, 0) : null,
      decision: body.decision,
      remarks: body.remarks || null,
    });
    const stage =
      body.decision === 'selected'
        ? 'selected'
        : body.decision === 'not_selected'
          ? 'rejected'
          : body.decision === 'on_hold'
            ? 'on_hold'
            : body.attendance === 'attended'
              ? 'interviewed'
              : body.attendance === 'not_attended'
                ? 'not_attended'
                : 'interview_scheduled';
    found.candidate.stage = { code: stage, name: STAGE_NAMES[stage] };
    found.holdReason = stage === 'on_hold' ? body.holdReason : null;
    found.nextFollowupDate = stage === 'on_hold' ? body.nextFollowupDate : null;
    found.rejectReason = stage === 'rejected' ? body.rejectReason : null;
    return found;
  }

  vi.stubGlobal(
    'fetch',
    vi.fn(async (address, options = {}) => {
      const url = new URL(address, 'http://test.local');
      const method = options.method ?? 'GET';
      const body = options.body ? JSON.parse(options.body) : null;
      state.calls.push({
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        method,
        body,
      });
      const path = url.pathname.replace('/api', '');

      if (path === '/interviews' && method === 'GET') {
        if (hang) return new Promise(() => {});
        if (state.listFails > 0) {
          state.listFails -= 1;
          return json(500, { error: 'Internal server error' });
        }
        const { search, decision } = Object.fromEntries(url.searchParams);
        let found = state.entries;
        if (search)
          found = found.filter((e) =>
            e.candidate.fullName.toLowerCase().includes(search.toLowerCase()),
          );
        if (decision === 'pending') found = found.filter((e) => !e.interview?.decision);
        else if (decision) found = found.filter((e) => e.interview?.decision === decision);
        return json(200, {
          items: found.map((e) => ({
            candidate: e.candidate,
            interview: e.interview,
            plannedAt: e.interview ? null : SLOT,
          })),
          total: found.length,
          page: 1,
          pageSize: 20,
        });
      }
      if (path === '/interviews' && method === 'POST') {
        const found = state.entries.find((e) => e.candidate.id === body.candidateId);
        const saved = save(found, body);
        return saved.ok === false ? saved : json(201, saved);
      }
      const one = path.match(/^\/interviews\/(\d+)$/);
      if (one) {
        const found = state.entries.find((e) => e.interview?.id === Number(one[1]));
        if (!found) return json(404, { error: 'not_found', message: 'Interview not found.' });
        if (method === 'PATCH') {
          const saved = save(found, body);
          return saved.ok === false ? saved : json(200, saved);
        }
        return json(200, found);
      }
      // The new-evaluation form reads the candidate and the agreed slot from here.
      const phone = path.match(/^\/candidates\/(\d+)\/phone-interview$/);
      if (phone) {
        const found = state.entries.find((e) => e.candidate.id === Number(phone[1]));
        if (!found) return json(404, { error: 'not_found', message: 'Candidate not found.' });
        return json(200, {
          candidate: found.candidate,
          phoneScreen: { id: 1, interviewAt: SLOT },
          rejectReason: null,
        });
      }
      return json(404, { error: 'Not found' });
    }),
  );
  return state;
}

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}
const currentPath = () => screen.getByTestId('location').textContent;

function open(path) {
  return render(
    <AuthContext.Provider value={SIGNED_IN}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const type = (label, value) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const typeScores = (...scores) =>
  SCORE_LABELS.forEach((label, index) => type(label, String(scores[index])));
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));
const total = () => screen.getByLabelText('Total score').textContent;
const callsTo = (backend, method, path) =>
  backend.calls.filter((call) => call.method === method && call.path === path);
// The form appears one step before its starting values are filled in, so wait
// for that step too. Otherwise typing straight away can be overwritten.
const formReady = async () => {
  await screen.findByLabelText('Technical');
  await act(async () => {});
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('interview list', () => {
  test('shows waiting candidates and recorded interviews with their status', async () => {
    fakeBackend({
      entries: [
        entry(1),
        entry(
          2,
          interviewRecord(702, {
            ...SCORED,
            decision: 'selected',
            interviewerName: 'Sample Interviewer',
          }),
          'selected',
        ),
        entry(3, interviewRecord(703, { ...SCORED, decision: 'not_selected' }), 'rejected'),
        entry(4, interviewRecord(704, { ...SCORED, decision: 'on_hold' }), 'on_hold'),
        entry(5, interviewRecord(705, { attendance: 'not_attended' }), 'not_attended'),
      ],
    });
    open('/interviews');

    const waiting = (await screen.findByText('TEST-001 — Sample Person 1')).closest('tr');
    expect(within(waiting).getByText('02 Nov 2026, 10:00')).toBeTruthy();
    expect(within(waiting).getByText('Not decided')).toBeTruthy();
    expect(within(waiting).queryByRole('link', { name: /^View/ })).toBeNull();
    expect(
      within(waiting)
        .getByRole('link', { name: 'Evaluate interview of Sample Person 1' })
        .getAttribute('href'),
    ).toBe('/interviews/new?candidate=1');

    const selected = screen.getByText('TEST-002 — Sample Person 2').closest('tr');
    expect(within(selected).getByText('Attended')).toBeTruthy();
    expect(within(selected).getByText('Sample Interviewer')).toBeTruthy();
    expect(within(selected).getByText('40 / 50')).toBeTruthy();
    expect(within(selected).getByText('Selected')).toBeTruthy();
    expect(
      within(selected)
        .getByRole('link', { name: 'Evaluate interview of Sample Person 2' })
        .getAttribute('href'),
    ).toBe('/interviews/702/evaluate');

    expect(
      within(screen.getByText('TEST-003 — Sample Person 3').closest('tr')).getByText(
        'Not Selected',
      ),
    ).toBeTruthy();
    expect(
      within(screen.getByText('TEST-004 — Sample Person 4').closest('tr')).getByText('On Hold'),
    ).toBeTruthy();
    expect(
      within(screen.getByText('TEST-005 — Sample Person 5').closest('tr')).getByText(
        'Not Attended',
      ),
    ).toBeTruthy();
  });

  test('says so when there are no interviews', async () => {
    fakeBackend();
    open('/interviews');

    expect(await screen.findByText('No interviews yet')).toBeTruthy();
  });

  test('shows a loading message while the request is running', async () => {
    fakeBackend({ hang: true });
    open('/interviews');

    expect(await screen.findByText('Loading interviews…')).toBeTruthy();
  });

  test('shows an error when the backend fails, and Try again recovers', async () => {
    fakeBackend({ entries: [entry(1)], listFails: 1 });
    open('/interviews');

    expect(await screen.findByText('The interviews could not be loaded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('TEST-001 — Sample Person 1')).toBeTruthy();
  });

  test('the status filter offers only the confirmed decisions and is sent to the backend', async () => {
    const backend = fakeBackend({
      entries: [
        entry(1),
        entry(2, interviewRecord(702, { ...SCORED, decision: 'on_hold' }), 'on_hold'),
      ],
    });
    open('/interviews');
    await screen.findByText('TEST-001 — Sample Person 1');

    expect([...screen.getByLabelText('Status').options].map((o) => o.textContent)).toEqual([
      'All',
      'Selected',
      'Not Selected',
      'On Hold',
      'Not decided yet',
    ]);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'on_hold' } });

    await waitFor(() => expect(screen.queryByText('TEST-001 — Sample Person 1')).toBeNull());
    expect(callsTo(backend, 'GET', '/api/interviews').at(-1).query.decision).toBe('on_hold');
  });
});

describe('interview evaluation: scores and total', () => {
  test('has the five score inputs from the task guide, each limited to 0-10', async () => {
    fakeBackend({ entries: [entry(1)] });
    open('/interviews/new?candidate=1');
    await formReady();

    for (const label of SCORE_LABELS) {
      const input = screen.getByLabelText(label);
      expect(input.type).toBe('number');
      expect(input.min).toBe('0');
      expect(input.max).toBe('10');
      expect(input.step).toBe('1');
    }
    expect(document.querySelectorAll('input[type=number]')).toHaveLength(5);
  });

  test('the total is worked out as the scores are typed', async () => {
    fakeBackend({ entries: [entry(1)] });
    open('/interviews/new?candidate=1');
    await formReady();

    expect(total()).toBe('--');
    typeScores(8, 7, 9, 6, '');
    expect(total()).toBe('--');
    type('Culture Fit', '10');
    expect(total()).toBe('40');
    type('Technical', '10');
    expect(total()).toBe('42');
    expect(screen.getByText(/Total Score:/).textContent).toContain('42 / 50');
  });

  test('the total shows 0 and 50 at the extremes, and nothing for an invalid score', async () => {
    fakeBackend({ entries: [entry(1)] });
    open('/interviews/new?candidate=1');
    await formReady();

    typeScores(0, 0, 0, 0, 0);
    expect(total()).toBe('0');
    typeScores(10, 10, 10, 10, 10);
    expect(total()).toBe('50');
    type('AI', '11');
    expect(total()).toBe('--');
  });

  test('the total cannot be typed: there is no input for it', async () => {
    fakeBackend({ entries: [entry(1)] });
    open('/interviews/new?candidate=1');
    await formReady();

    expect(screen.getByLabelText('Total score').tagName).toBe('OUTPUT');
    expect(document.querySelector('input[name*=total i], input[id*=total i]')).toBeNull();
  });

  test('an out-of-range or fractional score is stopped before anything is sent', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/interviews/new?candidate=1');
    await formReady();

    typeScores(11, 7.5, 9, 6, 10);
    save();

    expect(await screen.findByText('Technical must be a whole number from 0 to 10.')).toBeTruthy();
    expect(screen.getByText('AI must be a whole number from 0 to 10.')).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/interviews')).toHaveLength(0);
  });

  test('a partly scored interview is stopped, naming the missing scores', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/interviews/new?candidate=1');
    await formReady();

    type('Technical', '8');
    type('AI', '7');
    save();

    expect(
      await screen.findByText('Communication is missing. Enter all five scores or none.'),
    ).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/interviews')).toHaveLength(0);
  });
});

describe('interview evaluation: the form', () => {
  test('shows the candidate and starts with the slot agreed on the phone', async () => {
    fakeBackend({ entries: [entry(1)] });
    open('/interviews/new?candidate=1');
    await formReady();

    expect(screen.getByText('Sample Person 1')).toBeTruthy();
    expect(screen.getByText('Interview Scheduled')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByLabelText(/^Interview Date\/Time/).value).toBe('2026-11-02T10:00'),
    );
  });

  test('offers only the confirmed statuses, and no made-up Recommendation values', async () => {
    fakeBackend({ entries: [entry(1)] });
    open('/interviews/new?candidate=1');
    await formReady();

    expect([...screen.getByLabelText('Status').options].map((o) => o.textContent)).toEqual([
      'Select…',
      'Selected',
      'Not Selected',
      'On Hold',
    ]);
    expect([...screen.getByLabelText('Attendance').options].map((o) => o.textContent)).toEqual([
      'Select…',
      'Attended',
      'Not Attended',
    ]);

    const recommendation = screen.getByLabelText('Recommendation');
    expect(recommendation.disabled).toBe(true);
    expect([...recommendation.options].map((o) => o.textContent)).toEqual(['Not defined yet']);
  });

  test('Not Attended switches off the scores and the status, and clears them', async () => {
    fakeBackend({ entries: [entry(1)] });
    open('/interviews/new?candidate=1');
    await formReady();

    typeScores(8, 7, 9, 6, 10);
    fireEvent.change(screen.getByLabelText('Attendance'), { target: { value: 'not_attended' } });

    expect(screen.getByLabelText('Technical').closest('fieldset').disabled).toBe(true);
    expect(screen.getByLabelText('Technical').value).toBe('');
    expect(total()).toBe('--');
    expect(screen.getByLabelText('Status').disabled).toBe(true);
  });

  test('a status needs attendance and scores', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/interviews/new?candidate=1');
    await formReady();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'selected' } });
    save();

    expect(
      await screen.findByText('Mark the candidate as Attended before choosing a status.'),
    ).toBeTruthy();
    expect(screen.getByText('Enter all five scores before choosing a status.')).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/interviews')).toHaveLength(0);
  });

  test('On Hold asks for a reason and offers a follow-up date; Not Selected asks for its own reason', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/interviews/new?candidate=1');
    await formReady();

    expect(screen.queryByLabelText(/^Reason for hold/)).toBeNull();
    fireEvent.change(screen.getByLabelText('Attendance'), { target: { value: 'attended' } });
    typeScores(8, 7, 9, 6, 10);

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'on_hold' } });
    expect(screen.getByLabelText(/^Reason for hold/)).toBeTruthy();
    expect(screen.getByLabelText('Next follow-up date').type).toBe('date');
    save();
    expect(
      await screen.findByText('A reason for hold is required when the status is On Hold.'),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'not_selected' } });
    expect(screen.queryByLabelText(/^Reason for hold/)).toBeNull();
    save();
    expect(
      await screen.findByText(
        'A reason for rejection is required when the status is Not Selected.',
      ),
    ).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/interviews')).toHaveLength(0);
  });

  test('saves a Selected evaluation and shows the new status', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/interviews/new?candidate=1');
    await formReady();

    fireEvent.change(screen.getByLabelText('Attendance'), { target: { value: 'attended' } });
    type('Interviewer', 'Sample Interviewer');
    typeScores(8, 7, 9, 6, 10);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'selected' } });
    type('Remarks', 'Sample remark');
    save();

    expect(await screen.findByText('Interview saved. Current status: Selected.')).toBeTruthy();
    expect(currentPath()).toBe('/interviews/701');
    expect(await screen.findByText('40 / 50')).toBeTruthy();

    const sent = callsTo(backend, 'POST', '/api/interviews')[0].body;
    expect(sent).toEqual({
      candidateId: 1,
      scheduledAt: '2026-11-02T10:00:00+05:30',
      attendance: 'attended',
      interviewerName: 'Sample Interviewer',
      scoreTechnical: 8,
      scoreAi: 7,
      scoreCommunication: 9,
      scoreConfidence: 6,
      scoreCultureFit: 10,
      decision: 'selected',
      holdReason: '',
      nextFollowupDate: null,
      rejectReason: '',
      remarks: 'Sample remark',
    });
    // The total is never sent; the backend works it out.
    expect(Object.keys(sent).some((key) => /total/i.test(key))).toBe(false);
  });

  test('saves On Hold with its reason and follow-up date', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/interviews/new?candidate=1');
    await formReady();

    fireEvent.change(screen.getByLabelText('Attendance'), { target: { value: 'attended' } });
    typeScores(5, 5, 5, 5, 5);
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'on_hold' } });
    type(/^Reason for hold/, 'Sample hold reason');
    type('Next follow-up date', '2026-11-20');
    save();

    expect(await screen.findByText('Interview saved. Current status: On Hold.')).toBeTruthy();
    expect(await screen.findByText('Sample hold reason')).toBeTruthy();
    expect(screen.getByText('20 Nov 2026')).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/interviews')[0].body).toMatchObject({
      decision: 'on_hold',
      holdReason: 'Sample hold reason',
      nextFollowupDate: '2026-11-20',
    });
  });

  test('loads an existing interview and saves a change', async () => {
    const backend = fakeBackend({
      entries: [
        entry(
          1,
          interviewRecord(701, { ...SCORED, interviewerName: 'Sample Interviewer' }),
          'interviewed',
        ),
      ],
    });
    open('/interviews/701/evaluate');

    await waitFor(() => expect(screen.getByLabelText('Technical').value).toBe('8'));
    expect(screen.getByLabelText('Attendance').value).toBe('attended');
    expect(screen.getByLabelText('Interviewer').value).toBe('Sample Interviewer');
    expect(total()).toBe('40');

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'not_selected' } });
    type(/^Reason for rejection/, 'Sample rejection reason');
    save();

    expect(await screen.findByText('Interview saved. Current status: Rejected.')).toBeTruthy();
    expect(callsTo(backend, 'PATCH', '/api/interviews/701')[0].body).toMatchObject({
      decision: 'not_selected',
      rejectReason: 'Sample rejection reason',
      scoreTechnical: 8,
    });
  });

  test('shows a refusal from the backend next to the field, and saves nothing', async () => {
    const message =
      'This candidate has already moved on to "Offer Sent", so the interview result can no longer be changed.';
    fakeBackend({
      entries: [entry(1, interviewRecord(701, { ...SCORED, decision: 'selected' }), 'selected')],
      refuse: { decision: message },
    });
    open('/interviews/701/evaluate');
    await waitFor(() => expect(screen.getByLabelText('Status').value).toBe('selected'));

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: '' } });
    save();

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByText('Some fields need correcting. Nothing was saved.')).toBeTruthy();
    expect(currentPath()).toBe('/interviews/701/evaluate');
  });

  test('explains when no candidate was chosen, or it does not exist', async () => {
    fakeBackend();
    open('/interviews/new');
    expect(await screen.findByText('No candidate chosen')).toBeTruthy();
    cleanup();

    open('/interviews/new?candidate=999');
    expect(await screen.findByText('Candidate not found')).toBeTruthy();
    cleanup();

    open('/interviews/999/evaluate');
    expect(await screen.findByText('Interview not found')).toBeTruthy();
  });
});

describe('interview details', () => {
  test('shows the candidate, the five scores, the total, the status and the resulting stage', async () => {
    fakeBackend({
      entries: [
        entry(
          1,
          interviewRecord(701, {
            ...SCORED,
            decision: 'selected',
            interviewerName: 'Sample Interviewer',
            remarks: 'Sample remark',
          }),
          'selected',
        ),
      ],
    });
    open('/interviews/701');

    expect(await screen.findByText('Sample Person 1')).toBeTruthy();
    expect(screen.getByText('02 Nov 2026, 10:00')).toBeTruthy();
    expect(screen.getByText('Attended')).toBeTruthy();
    expect(screen.getByText('Sample Interviewer')).toBeTruthy();
    expect(screen.getByText('40 / 50')).toBeTruthy();
    expect(screen.getByText('Sample remark')).toBeTruthy();
    // "Selected" appears twice: the candidate's current status and the interview's status.
    expect(screen.getAllByText('Selected')).toHaveLength(2);

    for (const [label, score] of [
      ['Technical', '8'],
      ['AI', '7'],
      ['Communication', '9'],
      ['Confidence', '6'],
      ['Culture Fit', '10'],
    ]) {
      expect(within(screen.getByText(label).closest('div')).getByText(score)).toBeTruthy();
    }
    expect(screen.getByRole('link', { name: 'Evaluate interview' }).getAttribute('href')).toBe(
      '/interviews/701/evaluate',
    );
  });

  test('shows the rejection reason only for Not Selected', async () => {
    fakeBackend({
      entries: [
        entry(1, interviewRecord(701, { ...SCORED, decision: 'not_selected' }), 'rejected', {
          rejectReason: 'Sample rejection reason',
        }),
      ],
    });
    open('/interviews/701');

    expect(await screen.findByText('Sample rejection reason')).toBeTruthy();
    expect(screen.getByText('Not Selected')).toBeTruthy();
    expect(screen.getByText('Rejected')).toBeTruthy();
    expect(screen.queryByText('Reason for hold')).toBeNull();
  });

  test('shows the hold reason and follow-up date only for On Hold', async () => {
    fakeBackend({
      entries: [
        entry(1, interviewRecord(701, { ...SCORED, decision: 'on_hold' }), 'on_hold', {
          holdReason: 'Sample hold reason',
          nextFollowupDate: '2026-11-20',
        }),
      ],
    });
    open('/interviews/701');

    expect(await screen.findByText('Sample hold reason')).toBeTruthy();
    expect(screen.getByText('20 Nov 2026')).toBeTruthy();
    expect(screen.queryByText('Reason for rejection')).toBeNull();
  });

  test('says so when the interview does not exist', async () => {
    fakeBackend();
    open('/interviews/999');

    expect(await screen.findByText('Interview not found')).toBeTruthy();
  });
});

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
    permissions: ['candidates.view', 'offers.manage'],
  },
  login: async () => ({ ok: true }),
  logout: async () => ({ ok: true }),
};

const STAGE_NAMES = {
  interviewed: 'Interviewed',
  selected: 'Selected',
  offer_sent: 'Offer Sent',
  offer_accepted: 'Offer Accepted',
  joined: 'Joined',
};
const POSITIONS = [
  { id: 1, name: 'Sample Position A', isActive: true },
  { id: 2, name: 'Sample Position B', isActive: true },
  { id: 3, name: 'Sample Position Retired', isActive: false },
];

const candidate = (id, stage = 'selected') => ({
  id,
  candidateCode: `TEST-${String(id).padStart(3, '0')}`,
  fullName: `Sample Person ${id}`,
  phone: `07100000${String(id).padStart(2, '0')}`,
  position: 'Sample Position A',
  positionId: 1,
  stage: { code: stage, name: STAGE_NAMES[stage] },
});

const offerRecord = (id, overrides = {}) => ({
  id,
  positionId: 1,
  position: 'Sample Position A',
  offerDate: null,
  workMode: null,
  location: null,
  offerStatus: null,
  onboardingDate: null,
  attended: null,
  updatedAt: '2026-10-13T06:00:00.000Z',
  updatedBy: 'Test User',
  ...overrides,
});

// An entry is one candidate with (or without) an offer.
const entry = (id, offer = null, stage = 'selected') => ({
  candidate: candidate(id, stage),
  offer,
});

const stageFor = (body) =>
  body.attended === true
    ? 'joined'
    : body.offerStatus === 'accepted'
      ? 'offer_accepted'
      : body.offerStatus === 'sent'
        ? 'offer_sent'
        : 'selected';

// A pretend backend that keeps offers in memory and applies the same stage
// rules as the real one.
function fakeBackend({
  entries = [],
  positions = POSITIONS,
  listFails = 0,
  hang = false,
  refuse = null,
} = {}) {
  const state = { entries: entries.map((e) => structuredClone(e)), calls: [], listFails };
  const json = (status, data) => ({ ok: status < 400, status, json: async () => data });

  function save(found, body) {
    if (refuse) return json(422, { error: 'validation_failed', message: 'x', fields: refuse });
    const position = POSITIONS.find((p) => p.id === body.positionId);
    found.offer = offerRecord(found.offer?.id ?? found.candidate.id + 400, {
      positionId: body.positionId,
      position: position.name,
      offerDate: body.offerDate,
      workMode: body.workMode,
      location: body.location || null,
      offerStatus: body.offerStatus,
      onboardingDate: body.onboardingDate,
      attended: body.attended,
    });
    const stage = stageFor(body);
    found.candidate.stage = { code: stage, name: STAGE_NAMES[stage] };
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

      if (path === '/offers' && method === 'GET') {
        if (hang) return new Promise(() => {});
        if (state.listFails > 0) {
          state.listFails -= 1;
          return json(500, { error: 'Internal server error' });
        }
        const { search, offerStatus, waiting } = Object.fromEntries(url.searchParams);
        let found = state.entries;
        if (waiting === 'true') found = found.filter((e) => !e.offer);
        if (search)
          found = found.filter((e) =>
            e.candidate.fullName.toLowerCase().includes(search.toLowerCase()),
          );
        if (offerStatus === 'pending') found = found.filter((e) => !e.offer?.offerStatus);
        else if (offerStatus) found = found.filter((e) => e.offer?.offerStatus === offerStatus);
        return json(200, {
          items: found.map(({ candidate: c, offer }) => ({
            candidate: {
              id: c.id,
              candidateCode: c.candidateCode,
              fullName: c.fullName,
              position: c.position,
              stage: c.stage,
            },
            offer,
          })),
          total: found.length,
          page: 1,
          pageSize: 20,
        });
      }
      if (path === '/offers' && method === 'POST') {
        const found = state.entries.find((e) => e.candidate.id === body.candidateId);
        const saved = save(found, body);
        return saved.ok === false ? saved : json(201, saved);
      }
      const one = path.match(/^\/offers\/(\d+)$/);
      if (one) {
        const found = state.entries.find((e) => e.offer?.id === Number(one[1]));
        if (!found) return json(404, { error: 'not_found', message: 'Offer not found.' });
        if (method === 'PATCH') {
          const saved = save(found, body);
          return saved.ok === false ? saved : json(200, saved);
        }
        return json(200, found);
      }
      const person = path.match(/^\/candidates\/(\d+)$/);
      if (person) {
        const found = state.entries.find((e) => e.candidate.id === Number(person[1]));
        if (!found) return json(404, { error: 'not_found', message: 'Candidate not found.' });
        const { position, ...rest } = found.candidate;
        return json(200, { candidate: { ...rest, position: { id: 1, name: position } } });
      }
      if (path === '/lookups/positions') return json(200, { items: positions });
      return json(404, { error: 'Not found' });
    }),
  );
  return state;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
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
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));
const callsTo = (backend, method, path) =>
  backend.calls.filter((call) => call.method === method && call.path === path);
const optionsOf = (label) =>
  [...screen.getByLabelText(label).options].map((option) => option.textContent);
const noSalaryAnywhere = () => {
  expect(document.body.innerHTML).not.toMatch(/salary_lkr|salaryLkr|name="salary/i);
  expect(screen.queryByLabelText(/salary/i)).toBeNull();
  expect(screen.queryByRole('columnheader', { name: /salary/i })).toBeNull();
};
// The form appears one step before its starting values are filled in, so wait
// for that step too. Otherwise typing straight away can be overwritten.
const formReady = async () => {
  await screen.findByLabelText(/^Position Offered/);
  await act(async () => {});
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('offer list', () => {
  test('shows waiting candidates and offers with their details', async () => {
    fakeBackend({
      entries: [
        entry(1),
        entry(
          2,
          offerRecord(402, {
            offerDate: '2026-11-05',
            workMode: 'office',
            location: 'Sample Office',
            offerStatus: 'accepted',
            onboardingDate: '2026-11-16',
            attended: true,
          }),
          'joined',
        ),
        entry(
          3,
          offerRecord(403, { offerStatus: 'sent', position: 'Sample Position B' }),
          'offer_sent',
        ),
        entry(4, offerRecord(404)),
      ],
    });
    open('/offers');

    const waiting = (await screen.findByText('TEST-001 — Sample Person 1')).closest('tr');
    expect(within(waiting).getByText('No offer yet')).toBeTruthy();
    expect(within(waiting).getByText('Sample Position A')).toBeTruthy();
    expect(within(waiting).queryByRole('link', { name: /^View/ })).toBeNull();
    expect(
      within(waiting)
        .getByRole('link', { name: 'Create offer for Sample Person 1' })
        .getAttribute('href'),
    ).toBe('/offers/new?candidate=1');

    const joined = screen.getByText('TEST-002 — Sample Person 2').closest('tr');
    expect(within(joined).getByText('05 Nov 2026')).toBeTruthy();
    expect(within(joined).getByText('Office')).toBeTruthy();
    expect(within(joined).getByText('Sample Office')).toBeTruthy();
    expect(within(joined).getByText('Accepted')).toBeTruthy();
    expect(within(joined).getByText('16 Nov 2026')).toBeTruthy();
    expect(within(joined).getByText('Yes')).toBeTruthy();
    expect(within(joined).getByText('Not available yet')).toBeTruthy();
    expect(
      within(joined)
        .getByRole('link', { name: 'Edit offer of Sample Person 2' })
        .getAttribute('href'),
    ).toBe('/offers/402/edit');

    const sent = screen.getByText('TEST-003 — Sample Person 3').closest('tr');
    expect(within(sent).getByText('Sent')).toBeTruthy();
    expect(within(sent).getByText('Sample Position B')).toBeTruthy();
    expect(
      within(screen.getByText('TEST-004 — Sample Person 4').closest('tr')).getByText('Not sent'),
    ).toBeTruthy();

    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Candidate',
      'Position',
      'Offer Date',
      'Work Mode',
      'Location',
      'Offer Status',
      'Email Status',
      'Onboarding Date',
      'Attended',
      'Actions',
    ]);
    noSalaryAnywhere();
  });

  test('says so when there are no offers', async () => {
    fakeBackend();
    open('/offers');

    expect(await screen.findByText('No offers yet')).toBeTruthy();
  });

  test('shows a loading message while the request is running', async () => {
    fakeBackend({ hang: true });
    open('/offers');

    expect(await screen.findByText('Loading offers…')).toBeTruthy();
  });

  test('shows an error when the backend fails, and Try again recovers', async () => {
    fakeBackend({ entries: [entry(1)], listFails: 1 });
    open('/offers');

    expect(await screen.findByText('The offers could not be loaded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('TEST-001 — Sample Person 1')).toBeTruthy();
  });

  test('the status filter offers only the confirmed statuses and is sent to the backend', async () => {
    const backend = fakeBackend({
      entries: [entry(1), entry(2, offerRecord(402, { offerStatus: 'sent' }), 'offer_sent')],
    });
    open('/offers');
    await screen.findByText('TEST-001 — Sample Person 1');

    expect(optionsOf('Offer Status')).toEqual(['All', 'Sent', 'Accepted', 'No status yet']);
    fireEvent.change(screen.getByLabelText('Offer Status'), { target: { value: 'sent' } });

    await waitFor(() => expect(screen.queryByText('TEST-001 — Sample Person 1')).toBeNull());
    expect(callsTo(backend, 'GET', '/api/offers').at(-1).query.offerStatus).toBe('sent');
  });

  test('search and the onboarding dates are sent to the backend', async () => {
    const backend = fakeBackend({ entries: [entry(1), entry(2)] });
    open('/offers');
    await screen.findByText('TEST-001 — Sample Person 1');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Person 2' } });
    await waitFor(() => expect(screen.queryByText('TEST-001 — Sample Person 1')).toBeNull());
    type('Onboarding from', '2026-11-01');
    type('Onboarding to', '2026-11-30');

    await waitFor(() =>
      expect(callsTo(backend, 'GET', '/api/offers').at(-1).query).toMatchObject({
        search: 'Person 2',
        onboardingFrom: '2026-11-01',
        onboardingTo: '2026-11-30',
        page: '1',
      }),
    );
  });
});

describe('create offer', () => {
  test('opened on its own, lists the candidates waiting for an offer to choose from', async () => {
    const backend = fakeBackend({
      entries: [entry(1), entry(2, offerRecord(402, { offerStatus: 'sent' }), 'offer_sent')],
    });
    open('/offers/new');

    await screen.findByLabelText('Candidate');
    expect(optionsOf('Candidate')).toEqual(['Select…', 'TEST-001 — Sample Person 1']);
    expect(callsTo(backend, 'GET', '/api/offers')[0].query.waiting).toBe('true');

    fireEvent.change(screen.getByLabelText('Candidate'), { target: { value: '1' } });
    await formReady();
    expect(currentPath()).toBe('/offers/new?candidate=1');
  });

  test('says so when no candidate is waiting', async () => {
    fakeBackend();
    open('/offers/new');

    expect(await screen.findByText('No candidate is waiting for an offer')).toBeTruthy();
    // It explains why, and points to the Offer List for existing offers.
    expect(screen.getByText(/created automatically/)).toBeTruthy();
    const hint = screen.getByText(/To view or change an existing offer/);
    expect(within(hint).getByRole('link', { name: 'Offer List' }).getAttribute('href')).toBe(
      '/offers',
    );
    expect(screen.queryByLabelText('Candidate')).toBeNull();
  });

  test('shows the candidate, starts with their applied position, and offers only approved values', async () => {
    fakeBackend({ entries: [entry(1)] });
    open('/offers/new?candidate=1');
    await formReady();

    expect(screen.getByText('Sample Person 1')).toBeTruthy();
    expect(screen.getByText('Selected')).toBeTruthy();
    expect(screen.getByLabelText(/^Position Offered/).value).toBe('1');
    // A position that is switched off is not offered.
    expect(optionsOf(/^Position Offered/)).toEqual([
      'Select…',
      'Sample Position A',
      'Sample Position B',
    ]);
    expect(optionsOf('Offer Status')).toEqual(['Select…', 'Sent', 'Accepted']);
    expect(optionsOf('Attended')).toEqual(['Select…', 'Yes', 'No']);

    // Office is the only Work Mode approved so far, as a temporary value.
    const workMode = screen.getByLabelText('Work Mode');
    expect(workMode.disabled).toBe(false);
    expect(optionsOf('Work Mode')).toEqual(['Select…', 'Office']);
    expect(
      screen.getByText('Office is a temporary value that requires mentor confirmation.'),
    ).toBeTruthy();
  });

  test('with no positions yet, explains where to add them with a working link', async () => {
    fakeBackend({ entries: [entry(1)], positions: [] });
    open('/offers/new?candidate=1');
    await formReady();

    expect(optionsOf(/^Position Offered/)).toEqual(['Select…']);
    expect(screen.getByText(/No positions exist yet/)).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Administration → Positions & Sources' })
        .getAttribute('href'),
    ).toBe('/admin/lookups');
  });

  test('has no salary field and says why', async () => {
    fakeBackend({ entries: [entry(1)] });
    open('/offers/new?candidate=1');
    await formReady();

    noSalaryAnywhere();
    expect(
      screen.getByText(
        "Salary is never entered on this form. The Main User records it separately, on the offer's details page, where every view and change is logged.",
      ),
    ).toBeTruthy();
  });

  test('Attended is available only for an accepted offer with an onboarding date', async () => {
    fakeBackend({ entries: [entry(1)] });
    open('/offers/new?candidate=1');
    await formReady();

    expect(screen.getByLabelText('Attended').disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Offer Status'), { target: { value: 'accepted' } });
    expect(screen.getByLabelText('Attended').disabled).toBe(true);
    type('Onboarding Date', '2026-11-16');
    expect(screen.getByLabelText('Attended').disabled).toBe(false);

    fireEvent.change(screen.getByLabelText('Attended'), { target: { value: 'yes' } });
    fireEvent.change(screen.getByLabelText('Offer Status'), { target: { value: 'sent' } });
    expect(screen.getByLabelText('Attended').value).toBe('');
    expect(screen.getByLabelText('Attended').disabled).toBe(true);
  });

  test('a missing position is stopped before anything is sent', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/offers/new?candidate=1');
    await formReady();

    fireEvent.change(screen.getByLabelText(/^Position Offered/), { target: { value: '' } });
    save();

    expect(await screen.findByText('Position is required.')).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/offers')).toHaveLength(0);
  });

  test('saves the offer and shows the new status', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/offers/new?candidate=1');
    await formReady();

    fireEvent.change(screen.getByLabelText(/^Position Offered/), { target: { value: '2' } });
    type('Offer Date', '2026-11-05');
    fireEvent.change(screen.getByLabelText('Work Mode'), { target: { value: 'office' } });
    type('Location', 'Sample Office');
    fireEvent.change(screen.getByLabelText('Offer Status'), { target: { value: 'sent' } });
    save();

    expect(await screen.findByText('Offer saved. Current status: Offer Sent.')).toBeTruthy();
    expect(currentPath()).toBe('/offers/401');
    expect(await screen.findByText('Sample Position B')).toBeTruthy();

    const sent = callsTo(backend, 'POST', '/api/offers')[0].body;
    expect(sent).toEqual({
      candidateId: 1,
      positionId: 2,
      offerDate: '2026-11-05',
      workMode: 'office',
      location: 'Sample Office',
      offerStatus: 'sent',
      onboardingDate: null,
      attended: null,
    });
    // Salary is never sent.
    expect(Object.keys(sent).some((key) => /salary/i.test(key))).toBe(false);
  });

  test('shows a refusal from the backend next to the field, and stays on the form', async () => {
    fakeBackend({
      entries: [entry(1)],
      refuse: { positionId: 'This position is no longer in use.' },
    });
    open('/offers/new?candidate=1');
    await formReady();

    save();

    expect(await screen.findByText('This position is no longer in use.')).toBeTruthy();
    expect(screen.getByText('Some fields need correcting. Nothing was saved.')).toBeTruthy();
    expect(currentPath()).toBe('/offers/new?candidate=1');
  });

  test('explains when the candidate is not at Selected, and shows no form', async () => {
    fakeBackend({ entries: [entry(1, null, 'interviewed')] });
    open('/offers/new?candidate=1');

    expect(await screen.findByText('This candidate cannot receive an offer yet')).toBeTruthy();
    expect(screen.getByText(/This candidate is at “Interviewed”/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  test('explains when the candidate or the offer does not exist', async () => {
    fakeBackend();
    open('/offers/new?candidate=999');
    expect(await screen.findByText('Candidate not found')).toBeTruthy();
    cleanup();

    open('/offers/999/edit');
    expect(await screen.findByText('Offer not found')).toBeTruthy();
  });
});

describe('edit offer', () => {
  test('loads the offer and records acceptance, joining date and attendance', async () => {
    const backend = fakeBackend({
      entries: [
        entry(
          1,
          offerRecord(401, { offerStatus: 'sent', offerDate: '2026-11-05', workMode: 'office' }),
          'offer_sent',
        ),
      ],
    });
    open('/offers/401/edit');

    await waitFor(() => expect(screen.getByLabelText('Offer Status').value).toBe('sent'));
    expect(screen.getByLabelText('Offer Date').value).toBe('2026-11-05');
    expect(screen.getByLabelText('Work Mode').value).toBe('office');

    fireEvent.change(screen.getByLabelText('Offer Status'), { target: { value: 'accepted' } });
    type('Onboarding Date', '2026-11-16');
    fireEvent.change(screen.getByLabelText('Attended'), { target: { value: 'yes' } });
    save();

    expect(await screen.findByText('Offer saved. Current status: Joined.')).toBeTruthy();
    expect(callsTo(backend, 'PATCH', '/api/offers/401')[0].body).toMatchObject({
      offerStatus: 'accepted',
      onboardingDate: '2026-11-16',
      attended: true,
      workMode: 'office',
    });
  });

  test('keeps a position that has been switched off since the offer was made', async () => {
    fakeBackend({
      entries: [entry(1, offerRecord(401, { positionId: 3, position: 'Sample Position Retired' }))],
    });
    open('/offers/401/edit');

    await waitFor(() => expect(screen.getByLabelText(/^Position Offered/).value).toBe('3'));
    expect(optionsOf(/^Position Offered/)).toContain('Sample Position Retired');
  });
});

describe('offer details', () => {
  test('shows the candidate, the offer, the current stage and the email status', async () => {
    fakeBackend({
      entries: [
        entry(
          1,
          offerRecord(401, {
            offerDate: '2026-11-05',
            workMode: 'office',
            location: 'Sample Office',
            offerStatus: 'accepted',
            onboardingDate: '2026-11-16',
            attended: false,
          }),
          'offer_accepted',
        ),
      ],
    });
    open('/offers/401');

    expect(await screen.findByText('Sample Person 1')).toBeTruthy();
    const value = (label) => within(screen.getByText(label).closest('div')).getByRole('definition');
    expect(value('Position Offered').textContent).toBe('Sample Position A');
    expect(value('Offer Date').textContent).toBe('05 Nov 2026');
    expect(value('Work Mode').textContent).toBe('Office');
    expect(value('Location').textContent).toBe('Sample Office');
    expect(value('Offer Status').textContent).toBe('Accepted');
    expect(value('Email Status').textContent).toBe('Not available yet');
    expect(value('Onboarding Date').textContent).toBe('16 Nov 2026');
    expect(value('Attended').textContent).toBe('No');
    expect(value('Current Status').textContent).toBe('Offer Accepted');
    expect(screen.getByRole('link', { name: 'Edit offer' }).getAttribute('href')).toBe(
      '/offers/401/edit',
    );
    noSalaryAnywhere();
  });

  test('an offer not sent yet shows "Not sent"', async () => {
    fakeBackend({ entries: [entry(1, offerRecord(401))] });
    open('/offers/401');

    expect(await screen.findByText('Not sent')).toBeTruthy();
  });

  test('says so when the offer does not exist', async () => {
    fakeBackend();
    open('/offers/999');

    expect(await screen.findByText('Offer not found')).toBeTruthy();
  });
});

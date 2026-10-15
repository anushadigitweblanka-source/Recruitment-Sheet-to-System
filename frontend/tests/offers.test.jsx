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
  listStatus = 200,
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
        if (listStatus !== 200) return json(listStatus, { error: 'forbidden' });
        if (state.listFails > 0) {
          state.listFails -= 1;
          return json(500, { error: 'Internal server error' });
        }
        const { search, offerStatus, waiting } = Object.fromEntries(url.searchParams);
        // Like the real list: people with an offer, plus Selected candidates without one.
        let found = state.entries.filter((e) => e.offer || e.candidate.stage.code === 'selected');
        if (waiting === 'true') found = found.filter((e) => !e.offer);
        if (search)
          found = found.filter((e) =>
            [e.candidate.fullName, e.candidate.candidateCode].some((v) =>
              v.toLowerCase().includes(search.toLowerCase()),
            ),
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
      if (path === '/candidates' && method === 'GET') {
        const search = (url.searchParams.get('search') ?? '').toLowerCase();
        const found = state.entries.filter(({ candidate: c }) =>
          [c.fullName, c.candidateCode].some((v) => v.toLowerCase().includes(search)),
        );
        return json(200, {
          items: found.map(({ candidate: c }) => ({
            id: c.id,
            candidateCode: c.candidateCode,
            fullName: c.fullName,
            phone: c.phone,
            position: { id: c.positionId, name: c.position },
            stage: c.stage,
          })),
          total: found.length,
          page: 1,
          pageSize: 8,
        });
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

function open(path, auth = SIGNED_IN) {
  return render(
    <AuthContext.Provider value={auth}>
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
        .getByRole('link', { name: 'Prepare offer for Sample Person 1' })
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

describe('prepare offer', () => {
  // An offer the direct interview created automatically: nothing filled in yet.
  const automatic = (id) => entry(id, offerRecord(400 + id), 'selected');
  const saveOffer = () => fireEvent.click(screen.getByRole('button', { name: 'Save Offer' }));
  const choose = (id) =>
    fireEvent.change(screen.getByLabelText('Selected Candidate'), {
      target: { value: String(id) },
    });

  test('is named Prepare Offer, keeps the salary notice, and lists the selected candidates', async () => {
    const backend = fakeBackend({
      entries: [automatic(1), entry(2, offerRecord(402, { offerStatus: 'sent' }), 'offer_sent')],
    });
    open('/offers/new');

    expect(await screen.findByRole('heading', { name: 'Prepare Offer' })).toBeTruthy();
    await screen.findByRole('option', { name: 'TEST-001 — Sample Person 1' });
    expect(optionsOf('Selected Candidate')).toEqual([
      'Select…',
      'TEST-001 — Sample Person 1',
      'TEST-002 — Sample Person 2',
    ]);
    expect(screen.getByText(/Salary is never entered on this form/)).toBeTruthy();
    // The list comes from the offers API, not the waiting-only filter.
    expect(callsTo(backend, 'GET', '/api/offers')[0].query.waiting).toBeUndefined();
  });

  test('searching by Candidate ID or name asks the server and narrows the list', async () => {
    const backend = fakeBackend({ entries: [automatic(1), automatic(2)] });
    open('/offers/new');
    await screen.findByRole('option', { name: 'TEST-002 — Sample Person 2' });

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'TEST-002' } });
    await waitFor(() =>
      expect(optionsOf('Selected Candidate')).toEqual(['Select…', 'TEST-002 — Sample Person 2']),
    );
    expect(callsTo(backend, 'GET', '/api/offers').at(-1).query.search).toBe('TEST-002');
  });

  test('selecting a candidate loads their existing offer into the form', async () => {
    fakeBackend({
      entries: [
        entry(
          2,
          offerRecord(402, {
            positionId: 2,
            position: 'Sample Position B',
            offerDate: '2026-11-05',
            workMode: 'office',
            location: 'Sample Office',
            offerStatus: 'sent',
            onboardingDate: '2026-11-16',
          }),
          'offer_sent',
        ),
      ],
    });
    open('/offers/new');
    await screen.findByRole('option', { name: 'TEST-002 — Sample Person 2' });
    choose(2);
    await formReady();

    expect(currentPath()).toBe('/offers/new?candidate=2');
    expect(screen.getByLabelText(/^Position Offered/).value).toBe('2');
    expect(screen.getByLabelText('Offer Date').value).toBe('2026-11-05');
    expect(screen.getByLabelText('Work Mode').value).toBe('office');
    expect(screen.getByLabelText('Location').value).toBe('Sample Office');
    expect(screen.getByLabelText('Offer Status').value).toBe('sent');
    expect(screen.getByLabelText('Onboarding Date').value).toBe('2026-11-16');
    expect(screen.getByRole('button', { name: 'Save Offer' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'View the offer details' }).getAttribute('href')).toBe(
      '/offers/402',
    );
  });

  test('Save Offer updates the same offer, refreshes it and never creates another', async () => {
    const backend = fakeBackend({ entries: [automatic(1)] });
    open('/offers/new?candidate=1');
    await formReady();

    type('Offer Date', '2026-11-05');
    fireEvent.change(screen.getByLabelText('Work Mode'), { target: { value: 'office' } });
    type('Location', 'Sample Office');
    fireEvent.change(screen.getByLabelText('Offer Status'), { target: { value: 'sent' } });
    saveOffer();

    expect(await screen.findByText('Offer saved. Current status: Offer Sent.')).toBeTruthy();
    // Same record, same page, no navigation away.
    expect(currentPath()).toBe('/offers/new?candidate=1');
    expect(callsTo(backend, 'POST', '/api/offers')).toHaveLength(0);
    const patch = callsTo(backend, 'PATCH', '/api/offers/401');
    expect(patch).toHaveLength(1);
    expect(patch[0].body).toMatchObject({
      positionId: 1,
      offerDate: '2026-11-05',
      workMode: 'office',
      location: 'Sample Office',
      offerStatus: 'sent',
    });
    expect(Object.keys(patch[0].body).some((key) => /salary/i.test(key))).toBe(false);

    // The form shows the refreshed offer.
    await waitFor(() => expect(screen.getByLabelText('Location').value).toBe('Sample Office'));
    expect(screen.getByLabelText('Offer Status').value).toBe('sent');
    expect(screen.getByRole('button', { name: 'Save Offer' })).toBeTruthy();
  });

  test('a missing position is stopped before anything is sent', async () => {
    const backend = fakeBackend({ entries: [automatic(1)] });
    open('/offers/new?candidate=1');
    await formReady();

    fireEvent.change(screen.getByLabelText(/^Position Offered/), { target: { value: '' } });
    saveOffer();

    expect(await screen.findByText('Position is required.')).toBeTruthy();
    expect(callsTo(backend, 'PATCH', '/api/offers/401')).toHaveLength(0);
    expect(callsTo(backend, 'POST', '/api/offers')).toHaveLength(0);
  });

  test('attendance needs an accepted offer with an onboarding date, as before', async () => {
    const backend = fakeBackend({ entries: [automatic(1)] });
    open('/offers/new?candidate=1');
    await formReady();

    expect(screen.getByLabelText('Attended').disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Offer Status'), { target: { value: 'accepted' } });
    expect(screen.getByLabelText('Attended').disabled).toBe(true);
    type('Onboarding Date', '2026-11-16');
    expect(screen.getByLabelText('Attended').disabled).toBe(false);
    expect(optionsOf('Offer Status')).toEqual(['Select…', 'Sent', 'Accepted']);
    expect(optionsOf('Work Mode')).toEqual(['Select…', 'Office']);
    expect(callsTo(backend, 'PATCH', '/api/offers/401')).toHaveLength(0);
  });

  test('shows the backend refusal next to the field and keeps the entered values', async () => {
    fakeBackend({
      entries: [automatic(1)],
      refuse: { offerStatus: 'This offer cannot move to that status.' },
    });
    open('/offers/new?candidate=1');
    await formReady();

    type('Location', 'Typed Office');
    saveOffer();

    expect(await screen.findByText('This offer cannot move to that status.')).toBeTruthy();
    expect(screen.getByText('Some fields need correcting. Nothing was saved.')).toBeTruthy();
    expect(screen.getByLabelText('Location').value).toBe('Typed Office');
    expect(currentPath()).toBe('/offers/new?candidate=1');
  });

  test('a finalized offer locks status, onboarding date and attendance and says why', async () => {
    fakeBackend({
      entries: [
        entry(
          1,
          offerRecord(401, {
            offerStatus: 'accepted',
            onboardingDate: '2026-11-16',
            attended: true,
          }),
          'joined',
        ),
      ],
    });
    open('/offers/new?candidate=1');
    await formReady();

    expect(screen.getByText('This offer is finalized')).toBeTruthy();
    expect(screen.getByLabelText('Offer Status').disabled).toBe(true);
    expect(screen.getByLabelText('Onboarding Date').disabled).toBe(true);
    expect(screen.getByLabelText('Attended').disabled).toBe(true);
    expect(screen.getByLabelText('Location').disabled).toBe(false);
  });

  test('a Selected candidate with no offer explains the exception and creates the one offer', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/offers/new');
    await screen.findByRole('option', { name: 'TEST-001 — Sample Person 1 (no offer yet)' });
    choose(1);
    await formReady();

    expect(screen.getByText('No offer exists for this candidate yet')).toBeTruthy();
    expect(screen.getByText(/created here, once/)).toBeTruthy();
    expect(screen.getByLabelText(/^Position Offered/).value).toBe('1');
    expect(optionsOf(/^Position Offered/)).toEqual([
      'Select…',
      'Sample Position A',
      'Sample Position B',
    ]);

    fireEvent.change(screen.getByLabelText('Offer Status'), { target: { value: 'sent' } });
    saveOffer();

    expect(await screen.findByText('Offer saved. Current status: Offer Sent.')).toBeTruthy();
    const posts = callsTo(backend, 'POST', '/api/offers');
    expect(posts).toHaveLength(1);
    expect(posts[0].body.candidateId).toBe(1);
    // From now on the candidate has an offer, so the same form updates it.
    await waitFor(() =>
      expect(screen.queryByText('No offer exists for this candidate yet')).toBeNull(),
    );
    expect(await screen.findByLabelText('Offer Status')).toBeTruthy();
  });

  test('a candidate who is not Selected is explained and gets no form', async () => {
    fakeBackend({ entries: [entry(3, null, 'interviewed')] });
    open('/offers/new');
    await screen.findByLabelText('Selected Candidate');

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Person 3' } });
    fireEvent.click(
      await screen.findByRole('button', { name: 'Why Sample Person 3 cannot receive an offer' }),
    );

    expect(await screen.findByText('This candidate cannot receive an offer yet')).toBeTruthy();
    expect(screen.getByText('Interviewed', { selector: 'strong' })).toBeTruthy();
    expect(screen.getByText(/the offer is created automatically/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save Offer' })).toBeNull();
    expect(screen.queryByLabelText(/^Position Offered/)).toBeNull();
  });

  test('with nobody to prepare, says so and links to the Offer List', async () => {
    fakeBackend();
    open('/offers/new');

    expect(await screen.findByText('No selected candidate needs an offer prepared')).toBeTruthy();
    expect(screen.getByLabelText('Selected Candidate')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Go to the Offer List' }).getAttribute('href')).toBe(
      '/offers',
    );
  });

  test('without permission to view offers, says so and offers nothing to edit', async () => {
    fakeBackend({ entries: [automatic(1)], listStatus: 403 });
    open('/offers/new');

    expect(await screen.findByText('You do not have permission to view offers')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save Offer' })).toBeNull();
  });

  test('someone who may view but not manage offers sees the offer with no Save button', async () => {
    const backend = fakeBackend({ entries: [automatic(1)] });
    const viewer = {
      ...SIGNED_IN,
      user: { ...SIGNED_IN.user, permissions: ['candidates.view'] },
    };
    open('/offers/new?candidate=1', viewer);
    await formReady();

    expect(screen.getByText('You can view this offer, not change it')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save Offer' })).toBeNull();
    expect(screen.getByLabelText('Location').disabled).toBe(true);
    expect(screen.getByLabelText('Offer Status').disabled).toBe(true);
    expect(callsTo(backend, 'PATCH', '/api/offers/401')).toHaveLength(0);
  });

  test('has no salary field and sends no salary', async () => {
    fakeBackend({ entries: [automatic(1)] });
    open('/offers/new?candidate=1');
    await formReady();

    noSalaryAnywhere();
    expect(
      screen.getByText(
        "Salary is never entered on this form. The Main User records it separately, on the offer's details page, where every view and change is logged.",
      ),
    ).toBeTruthy();
  });

  test('with no positions yet, explains where to add them with a working link', async () => {
    fakeBackend({ entries: [automatic(1)], positions: [] });
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

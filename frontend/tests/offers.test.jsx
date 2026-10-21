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
    if (body.workMode && body.workMode !== 'office') {
      return json(422, {
        error: 'validation_failed',
        message: 'Some fields need correcting.',
        fields: { workMode: 'Work Mode must be Office.' },
      });
    }
    const merged = {
      positionId: found.offer?.positionId ?? body.positionId,
      offerDate: found.offer?.offerDate ?? null,
      workMode: found.offer?.workMode ?? null,
      location: found.offer?.location ?? null,
      offerStatus: found.offer?.offerStatus ?? null,
      onboardingDate: found.offer?.onboardingDate ?? null,
      attended: found.offer?.attended ?? null,
      ...body,
    };
    const position = POSITIONS.find((p) => p.id === merged.positionId);
    found.offer = offerRecord(found.offer?.id ?? found.candidate.id + 400, {
      positionId: merged.positionId,
      position: position.name,
      offerDate: merged.offerDate,
      workMode: merged.workMode,
      location: merged.location || null,
      offerStatus: merged.offerStatus,
      onboardingDate: merged.onboardingDate,
      attended: merged.attended,
    });
    const stage = stageFor(merged);
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
    expect(within(joined).getByText('Not sent')).toBeTruthy();
    expect(
      within(joined)
        .getByRole('link', { name: 'Edit offer of Sample Person 2' })
        .getAttribute('href'),
    ).toBe('/offers/402/edit');

    const sent = screen.getByText('TEST-003 — Sample Person 3').closest('tr');
    expect(within(sent).getByText('Sent')).toBeTruthy();
    expect(within(sent).getByText('Sample Position B')).toBeTruthy();
    // No offer status yet, and no joining mail in the email log.
    expect(
      within(screen.getByText('TEST-004 — Sample Person 4').closest('tr')).getAllByText('Not sent')
        .length,
    ).toBe(2);

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
    // The salary banner is not on this page.
    expect(screen.queryByText('Salary is not part of this screen')).toBeNull();
    // The list comes from the offers API, not the waiting-only filter.
    expect(callsTo(backend, 'GET', '/api/offers')[0].query.waiting).toBeUndefined();
  });

  test('has only the Selected Candidate dropdown: no search box and no explanatory text', async () => {
    fakeBackend({ entries: [automatic(1), automatic(2)] });
    open('/offers/new');
    await screen.findByRole('option', { name: 'TEST-002 — Sample Person 2' });

    expect(screen.getByLabelText('Selected Candidate')).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByLabelText(/Search candidates/)).toBeNull();
    expect(screen.queryByText(/Candidates whose direct interview result is Selected/)).toBeNull();
  });

  test('shows all seven fields in two columns, disabled until a candidate is selected', async () => {
    fakeBackend({ entries: [automatic(1)] });
    open('/offers/new');
    await screen.findByRole('option', { name: 'TEST-001 — Sample Person 1' });

    const labels = [
      'Position Offered',
      'Offer Date',
      'Work Mode',
      'Location',
      'Offer Status',
      'Onboarding Date',
      'Attended',
    ];
    for (const label of labels) {
      expect(screen.getByLabelText(new RegExp('^' + label)).disabled).toBe(true);
    }
    expect(screen.getByRole('button', { name: 'Save Offer' }).disabled).toBe(true);
    expect(document.querySelector('.form-grid--two')).toBeTruthy();
    expect(document.querySelector('.form-actions--end')).toBeTruthy();

    // Selected Candidate is the one control at the top of the page.
    expect(screen.getByLabelText('Selected Candidate')).toBeTruthy();

    // Choosing a candidate switches the fields on and fills them in.
    choose(1);
    await formReady();
    expect(screen.getByLabelText(/^Position Offered/).disabled).toBe(false);
    expect(screen.getByLabelText(/^Position Offered/).value).toBe('1');
    expect(screen.getByRole('button', { name: 'Save Offer' }).disabled).toBe(false);
    expect(document.querySelector('.form-grid--two')).toBeTruthy();
    expect(document.querySelector('.form-actions--end')).toBeTruthy();
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
    fireEvent.change(screen.getByLabelText('Work Mode'), { target: { value: 'online' } });
    expect(screen.getByRole('button', { name: 'Save Offer' }).disabled).toBe(true);
    expect(screen.getByText(/backend and database currently support Office only/)).toBeTruthy();
    expect(callsTo(backend, 'PATCH', '/api/offers/401')).toHaveLength(0);
    fireEvent.change(screen.getByLabelText('Work Mode'), { target: { value: 'office' } });
    expect(screen.getByRole('button', { name: 'Save Offer' }).disabled).toBe(false);
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

  test('Accepted uses the existing workflow and Not Accepted stays an unsaved draft', async () => {
    const backend = fakeBackend({ entries: [automatic(1)] });
    open('/offers/new?candidate=1');
    await formReady();

    const status = screen.getByLabelText('Offer Status');
    expect(optionsOf('Offer Status')).toEqual(['Select...', 'Sent', 'Accepted', 'Not Accepted']);
    fireEvent.change(status, { target: { value: 'not_accepted_draft' } });
    expect(status.value).toBe('not_accepted_draft');
    expect(screen.getByRole('button', { name: 'Save Offer' }).disabled).toBe(true);
    expect(
      screen.getByText(/no approved offer-rejection workflow or database status exists/),
    ).toBeTruthy();
    expect(callsTo(backend, 'PATCH', '/api/offers/401')).toHaveLength(0);

    fireEvent.change(status, { target: { value: 'accepted' } });
    expect(screen.getByRole('button', { name: 'Save Offer' }).disabled).toBe(false);
    saveOffer();
    expect(await screen.findByText('Offer saved. Current status: Offer Accepted.')).toBeTruthy();
    expect(callsTo(backend, 'PATCH', '/api/offers/401')[0].body.offerStatus).toBe('accepted');
  });

  test('the result of Save Offer brings itself into view, refusal and success alike', async () => {
    const scrolled = vi.fn();
    window.HTMLElement.prototype.scrollIntoView = scrolled;
    try {
      fakeBackend({
        entries: [automatic(1)],
        refuse: { offerStatus: 'This offer cannot move to that status.' },
      });
      open('/offers/new?candidate=1');
      await formReady();
      saveOffer();
      expect(
        await screen.findByText('Some fields need correcting. Nothing was saved.'),
      ).toBeTruthy();
      await waitFor(() => expect(scrolled).toHaveBeenCalled());
      cleanup();

      scrolled.mockClear();
      fakeBackend({ entries: [automatic(1)] });
      open('/offers/new?candidate=1');
      await formReady();
      saveOffer();
      expect(await screen.findByText(/Offer saved\./)).toBeTruthy();
      await waitFor(() => expect(scrolled).toHaveBeenCalled());
    } finally {
      delete window.HTMLElement.prototype.scrollIntoView;
    }
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
    expect(
      screen.getByText(/Disabled: set Offer Status to Accepted and set an Onboarding/),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Offer Status'), { target: { value: 'accepted' } });
    expect(screen.getByLabelText('Attended').disabled).toBe(true);
    expect(screen.getByText('Disabled: set an Onboarding Date.')).toBeTruthy();
    type('Onboarding Date', '2026-11-16');
    // Unlocks at once from the form values; no Save is needed first.
    expect(screen.getByLabelText('Attended').disabled).toBe(false);
    expect(screen.getByText(/once saved, creates the employee/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Offer Status'), { target: { value: 'sent' } });
    expect(screen.getByLabelText('Attended').disabled).toBe(true);
    expect(screen.getByText('Disabled: set Offer Status to Accepted.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Offer Status'), { target: { value: 'accepted' } });
    expect(optionsOf('Offer Status')).toEqual(['Select...', 'Sent', 'Accepted', 'Not Accepted']);
    expect(optionsOf('Work Mode')).toEqual(['Select…', 'Online', 'Work from Home', 'Office']);
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

  test('a finalized offer keeps joining edits as unsaved drafts and says why', async () => {
    const backend = fakeBackend({
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
    const status = screen.getByLabelText('Offer Status');
    expect(status.disabled).toBe(false);
    expect(optionsOf('Offer Status')).toEqual(['Accepted', 'Not Accepted']);
    expect(status.value).toBe('accepted');
    fireEvent.change(status, { target: { value: 'not_accepted_draft' } });
    expect(status.value).toBe('not_accepted_draft');
    expect(
      screen.getByText(/Saved Offer Status: Accepted\. The selected status is only a draft/),
    ).toBeTruthy();
    const date = screen.getByLabelText('Onboarding Date');
    const attended = screen.getByLabelText('Attended');
    expect(date.disabled).toBe(false);
    expect(attended.disabled).toBe(false);
    fireEvent.change(date, { target: { value: '2026-11-18' } });
    fireEvent.change(attended, { target: { value: 'no' } });
    expect(screen.getByRole('button', { name: 'Save Offer' }).disabled).toBe(true);
    expect(screen.getByText(/employee-lifecycle correction workflow is required/)).toBeTruthy();
    expect(callsTo(backend, 'PATCH', '/api/offers/401')).toHaveLength(0);
    expect(screen.getByLabelText('Location').disabled).toBe(false);
    expect(screen.getAllByText(/Locked: the candidate has joined/).length).toBe(3);
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
    open('/offers/new?candidate=3');

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
    // Nothing can be saved: the form stays switched off.
    expect(screen.getByRole('button', { name: 'Save Offer' }).disabled).toBe(true);
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
    // No salary banner, heading or paragraph either.
    expect(screen.queryByText('Salary is not part of this screen')).toBeNull();
    expect(screen.queryByText(/Salary is never entered on this form/)).toBeNull();
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
  test('shows and saves onboarding date and attendance, while Remark remains a separate draft', async () => {
    const backend = fakeBackend({
      entries: [
        entry(
          1,
          offerRecord(401, {
            offerStatus: 'accepted',
            onboardingDate: '2026-11-16',
            attended: false,
          }),
          'offer_accepted',
        ),
      ],
    });
    open('/offers/401/edit');

    const date = await screen.findByLabelText('Onboarding Date');
    const attended = screen.getByLabelText('Attended');
    const remark = screen.getByPlaceholderText('Enter remark...');
    await waitFor(() => expect(date.value).toBe('2026-11-16'));
    expect(date.type).toBe('date');
    expect(date.value).toBe('2026-11-16');
    expect(optionsOf('Attended')).toEqual(['Select...', 'Yes', 'No']);
    expect(attended.value).toBe('no');
    expect(attended.disabled).toBe(false);
    expect(remark.tagName).toBe('TEXTAREA');
    expect(screen.getByText(/Entered text remains a draft and will not be stored/)).toBeTruthy();

    fireEvent.change(date, { target: { value: '2026-11-18' } });
    fireEvent.change(attended, { target: { value: 'yes' } });
    fireEvent.change(remark, { target: { value: 'Fictional HR comment' } });
    expect(callsTo(backend, 'PATCH', '/api/offers/401')).toHaveLength(0);
    save();

    expect(
      await screen.findByText(/Remark was not saved because offer remark storage is unavailable/),
    ).toBeTruthy();
    const payload = callsTo(backend, 'PATCH', '/api/offers/401')[0].body;
    expect(payload).toMatchObject({ onboardingDate: '2026-11-18', attended: true });
    expect(payload).not.toHaveProperty('remark');
  });

  test('keeps joined offer date and attendance protected while showing Remark as a draft', async () => {
    const backend = fakeBackend({
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
    open('/offers/401/edit');

    const date = await screen.findByLabelText('Onboarding Date');
    const attended = screen.getByLabelText('Attended');
    const remark = screen.getByPlaceholderText('Enter remark...');
    await waitFor(() => expect(date.value).toBe('2026-11-16'));
    expect(date.value).toBe('2026-11-16');
    expect(date.disabled).toBe(false);
    expect(optionsOf('Attended')).toEqual(['Select...', 'Yes', 'No']);
    expect(attended.value).toBe('yes');
    expect(attended.disabled).toBe(false);
    expect(remark.disabled).toBe(false);
    const status = screen.getByLabelText('Offer Status');
    expect(status.value).toBe('accepted');
    expect(optionsOf('Offer Status')).toEqual(['Accepted', 'Not Accepted']);
    fireEvent.change(status, { target: { value: 'not_accepted_draft' } });
    expect(status.value).toBe('not_accepted_draft');
    expect(screen.getByText(/Saved Offer Status: Accepted/)).toBeTruthy();
    fireEvent.change(date, { target: { value: '2026-11-18' } });
    fireEvent.change(attended, { target: { value: 'no' } });
    fireEvent.change(remark, { target: { value: 'Fictional joined-offer note' } });
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(true);
    expect(screen.getByText(/employee-lifecycle correction workflow is required/)).toBeTruthy();
    expect(callsTo(backend, 'PATCH', '/api/offers/401')).toHaveLength(0);
    expect(screen.getByText(/Saving other offer fields will not save this remark/)).toBeTruthy();
  });

  test('users without offer permission cannot draft a joined offer correction', async () => {
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
    const viewer = {
      ...SIGNED_IN,
      user: { ...SIGNED_IN.user, permissions: ['candidates.view'] },
    };
    open('/offers/401/edit', viewer);

    expect(await screen.findByLabelText('Offer Status')).toBeTruthy();
    expect(screen.getByLabelText('Offer Status').disabled).toBe(true);
    expect(screen.getByLabelText('Onboarding Date').disabled).toBe(true);
    expect(screen.getByLabelText('Attended').disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

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
    expect(optionsOf('Offer Status')).toEqual(['Select...', 'Sent', 'Accepted', 'Not Accepted']);
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
    await waitFor(() => expect(screen.getByLabelText('Work Mode').value).toBe('office'));
    const value = (label) => within(screen.getByText(label).closest('div')).getByRole('definition');
    expect(value('Position Offered').textContent).toBe('Sample Position A');
    expect(value('Offer Date').textContent).toBe('05 Nov 2026');
    expect(screen.getByLabelText('Work Mode').value).toBe('office');
    expect(
      [...screen.getByLabelText('Work Mode').options].map((option) => option.textContent),
    ).toEqual(['Select...', 'Online', 'Work from Home', 'Office']);
    expect(value('Location').textContent).toBe('Sample Office');
    expect(value('Offer Status').textContent).toBe('Accepted');
    expect(value('Email Status').textContent).toBe('Not sent');
    expect(value('Onboarding Date').textContent).toBe('16 Nov 2026');
    expect(value('Attended').textContent).toBe('No');
    expect(value('Current Status').textContent).toBe('Offer Accepted');
    expect(screen.getByRole('link', { name: 'Edit offer' }).getAttribute('href')).toBe(
      '/offers/401/edit',
    );
    noSalaryAnywhere();
  });

  test('Work Mode changes are saved explicitly through the offer update API', async () => {
    const backend = fakeBackend({
      entries: [
        entry(
          1,
          offerRecord(401, {
            workMode: null,
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
    const selector = await screen.findByLabelText('Work Mode');
    fireEvent.change(selector, { target: { value: 'office' } });
    expect(callsTo(backend, 'PATCH', '/api/offers/401')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Save Work Mode' }));

    expect(await screen.findByText('Work Mode saved.')).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Work Mode').value).toBe('office'));
    expect(callsTo(backend, 'PATCH', '/api/offers/401')[0].body).toEqual({ workMode: 'office' });
    expect(screen.getByText('Sample Office')).toBeTruthy();
    expect(screen.getByText('Accepted')).toBeTruthy();
    expect(screen.getByText('16 Nov 2026')).toBeTruthy();
    expect(screen.getByText('Offer Accepted')).toBeTruthy();
  });

  test('Work Mode values outside the current backend constraint cannot be saved', async () => {
    const backend = fakeBackend({
      entries: [entry(1, offerRecord(401, { workMode: 'office' }), 'offer_sent')],
    });
    open('/offers/401');
    const selector = await screen.findByLabelText('Work Mode');
    fireEvent.change(selector, { target: { value: 'online' } });
    expect(screen.getByRole('button', { name: 'Save Work Mode' }).disabled).toBe(true);

    expect(
      await screen.findByText(/database constraint currently support Office only/),
    ).toBeTruthy();
    expect(callsTo(backend, 'PATCH', '/api/offers/401')).toHaveLength(0);
    expect(screen.getByLabelText('Work Mode').value).toBe('online');
    expect(backend.entries[0].offer.workMode).toBe('office');

    fireEvent.change(selector, { target: { value: 'work_from_home' } });
    expect(selector.value).toBe('work_from_home');
    expect(screen.getByRole('button', { name: 'Save Work Mode' }).disabled).toBe(true);
  });

  test('users without offer management permission cannot edit Work Mode', async () => {
    fakeBackend({ entries: [entry(1, offerRecord(401, { workMode: 'office' }), 'offer_sent')] });
    const viewOnly = {
      ...SIGNED_IN,
      user: { ...SIGNED_IN.user, permissions: ['candidates.view'] },
    };
    open('/offers/401', viewOnly);

    const selector = await screen.findByLabelText('Work Mode');
    expect(selector.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save Work Mode' })).toBeNull();
  });

  test('an offer not sent yet shows "Not sent"', async () => {
    fakeBackend({ entries: [entry(1, offerRecord(401))] });
    open('/offers/401');

    // Both the offer status and the email status read "Not sent".
    expect((await screen.findAllByText('Not sent')).length).toBe(2);
  });

  test('says so when the offer does not exist', async () => {
    fakeBackend();
    open('/offers/999');

    expect(await screen.findByText('Offer not found')).toBeTruthy();
  });
});

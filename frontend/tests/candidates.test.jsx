// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.jsx';
import { AuthContext } from '../src/auth/AuthContext.jsx';

// Every name, phone number and address in this file is made up.

const SIGNED_IN = {
  status: 'authenticated',
  user: {
    id: 1,
    email: 'test.user@example.test',
    fullName: 'Test User',
    role: { code: 'main_user', name: 'Main User' },
    permissions: ['candidates.view', 'candidates.edit', 'admin.manage'],
  },
  login: async () => ({ ok: true }),
  logout: async () => ({ ok: true }),
};

const STAGES = [
  { code: 'applied', name: 'Applied' },
  { code: 'on_hold', name: 'On Hold' },
];

function sampleCandidate(id, overrides = {}) {
  return {
    id,
    candidateCode: `TEST-${String(id).padStart(3, '0')}`,
    fullName: `Sample Person ${id}`,
    phone: `07100000${String(id).padStart(2, '0')}`,
    email: `sample.person.${id}@example.test`,
    address: null,
    olMaths: null,
    alResult: null,
    alStream: null,
    otherEducation: null,
    positionId: null,
    position: null,
    sourceId: null,
    source: null,
    cvUrl: null,
    companyCvUrl: null,
    companyCvStatus: 'not_sent',
    hrComment: null,
    stage: { code: 'applied', name: 'Applied' },
    createdAt: '2026-10-13T06:00:00.000Z',
    createdBy: 'Test User',
    updatedAt: '2026-10-13T06:00:00.000Z',
    updatedBy: 'Test User',
    ...overrides,
  };
}

// A pretend backend that keeps candidates in memory and answers like the real one.
function fakeBackend({
  candidates = [],
  positions = [],
  sources = [],
  listFails = 0,
  hang = false,
} = {}) {
  const state = {
    candidates: [...candidates],
    positions: [...positions],
    sources: [...sources],
    calls: [],
    listFails,
  };
  const json = (status, data) => ({ ok: status < 400, status, json: async () => data });
  const named = (list, id) => {
    const item = list.find((entry) => entry.id === id);
    return item ? { id: item.id, name: item.name } : null;
  };
  const withNames = (data) => ({
    ...data,
    position: named(state.positions, data.positionId),
    source: named(state.sources, data.sourceId),
  });
  const last9 = (phone) => (phone ? phone.replace(/\D/g, '').slice(-9) : null);

  function save(body, existing) {
    const { confirmDuplicate, ...data } = body;
    const fields = {};
    if (!data.candidateCode?.trim()) fields.candidateCode = 'Candidate ID is required.';
    if (!data.fullName?.trim()) fields.fullName = 'Name is required.';
    if (state.candidates.some((c) => c !== existing && c.candidateCode === data.candidateCode)) {
      fields.candidateCode = 'This Candidate ID is already used by another candidate.';
    }
    if (Object.keys(fields).length > 0) {
      return json(422, {
        error: 'validation_failed',
        message: 'Some fields need correcting.',
        fields,
      });
    }

    const phone = data.phone ? data.phone.replace(/[\s\-().]/g, '') : null;
    const duplicates = state.candidates
      .filter((c) => c !== existing && last9(phone) && last9(c.phone) === last9(phone))
      .map((c) => ({
        id: c.id,
        candidateCode: c.candidateCode,
        fullName: c.fullName,
        phone: c.phone,
        email: c.email,
        position: null,
        matchedOn: ['phone'],
      }));
    if (duplicates.length > 0 && !confirmDuplicate) {
      return json(409, { error: 'possible_duplicate', message: 'Possible duplicate.', duplicates });
    }

    const cleaned = Object.fromEntries(
      Object.entries(data).map(([key, value]) => [key, value === '' ? null : value]),
    );
    const saved = withNames({
      ...(existing ?? sampleCandidate(state.candidates.length + 101)),
      ...cleaned,
      phone,
    });
    if (existing) state.candidates[state.candidates.indexOf(existing)] = saved;
    else state.candidates.push(saved);
    return json(existing ? 200 : 201, { candidate: saved });
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

      if (path === '/lookups/stages') return json(200, { items: STAGES });
      const lookup = path.match(/^\/lookups\/(positions|sources)$/);
      if (lookup && method === 'GET') return json(200, { items: state[lookup[1]] });
      if (lookup && method === 'POST') {
        const item = { id: state[lookup[1]].length + 51, name: body.name.trim(), isActive: true };
        state[lookup[1]].push(item);
        return json(201, { item });
      }

      if (path === '/candidates' && method === 'GET') {
        if (hang) return new Promise(() => {});
        if (state.listFails > 0) {
          state.listFails -= 1;
          return json(500, { error: 'Internal server error' });
        }
        const {
          search,
          positionId,
          page = '1',
          pageSize = '20',
        } = Object.fromEntries(url.searchParams);
        let found = state.candidates;
        if (search)
          found = found.filter((c) => c.fullName.toLowerCase().includes(search.toLowerCase()));
        if (positionId) found = found.filter((c) => String(c.positionId) === positionId);
        const start = (Number(page) - 1) * Number(pageSize);
        return json(200, {
          items: found.slice(start, start + Number(pageSize)),
          total: found.length,
          page: Number(page),
          pageSize: Number(pageSize),
        });
      }
      if (path === '/candidates' && method === 'POST') return save(body, null);

      const one = path.match(/^\/candidates\/(\d+)$/);
      if (one) {
        const existing = state.candidates.find((c) => c.id === Number(one[1]));
        if (!existing) return json(404, { error: 'not_found', message: 'Candidate not found.' });
        return method === 'PUT' ? save(body, existing) : json(200, { candidate: existing });
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
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));
const callsTo = (backend, method, path) =>
  backend.calls.filter((call) => call.method === method && call.path === path);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('candidate list', () => {
  test('shows the candidates from the backend, with the leading zero of each phone', async () => {
    fakeBackend({ candidates: [sampleCandidate(1), sampleCandidate(2)] });
    open('/candidates');

    const row = (await screen.findByText('Sample Person 1')).closest('tr');
    expect(within(row).getByText('0710000001')).toBeTruthy();
    expect(within(row).getByText('Applied')).toBeTruthy();
    expect(within(row).getByRole('link', { name: 'TEST-001' }).getAttribute('href')).toBe(
      '/candidates/1',
    );
    expect(
      within(row).getByRole('link', { name: 'Edit Sample Person 1' }).getAttribute('href'),
    ).toBe('/candidates/1/edit');
    expect(screen.getByText('Sample Person 2')).toBeTruthy();
    expect(screen.getByText('Showing 1–2 of 2')).toBeTruthy();
  });

  test('says so when there are no candidates yet', async () => {
    fakeBackend();
    open('/candidates');

    expect(await screen.findByText('No candidates yet')).toBeTruthy();
  });

  test('shows a loading message while the request is running', async () => {
    fakeBackend({ hang: true });
    open('/candidates');

    expect(await screen.findByText('Loading candidates…')).toBeTruthy();
    expect(screen.queryByText('No candidates yet')).toBeNull();
  });

  test('shows an error when the backend fails, and Try again recovers', async () => {
    fakeBackend({ candidates: [sampleCandidate(1)], listFails: 1 });
    open('/candidates');

    expect(await screen.findByText('The candidates could not be loaded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Sample Person 1')).toBeTruthy();
  });

  test('searching asks the backend and shows only the matches', async () => {
    const backend = fakeBackend({
      candidates: [sampleCandidate(1), sampleCandidate(2, { fullName: 'Different Name' })],
    });
    open('/candidates');
    await screen.findByText('Sample Person 1');

    type('Search', 'different');

    await waitFor(() => expect(screen.queryByText('Sample Person 1')).toBeNull());
    expect(screen.getByText('Different Name')).toBeTruthy();
    expect(callsTo(backend, 'GET', '/api/candidates').at(-1).query.search).toBe('different');
  });

  test('a search with no matches says so', async () => {
    fakeBackend({ candidates: [sampleCandidate(1)] });
    open('/candidates');
    await screen.findByText('Sample Person 1');

    type('Search', 'nobody');

    expect(await screen.findByText('No candidates match')).toBeTruthy();
  });

  test('the position filter is filled from the lookup list and sent to the backend', async () => {
    const backend = fakeBackend({
      positions: [{ id: 7, name: 'Test Position', isActive: true }],
      candidates: [sampleCandidate(1, { positionId: 7 }), sampleCandidate(2)],
    });
    open('/candidates');
    await screen.findByText('Sample Person 2');

    fireEvent.change(screen.getByLabelText('Position'), { target: { value: '7' } });

    await waitFor(() => expect(screen.queryByText('Sample Person 2')).toBeNull());
    expect(screen.getByText('Sample Person 1')).toBeTruthy();
    expect(callsTo(backend, 'GET', '/api/candidates').at(-1).query.positionId).toBe('7');
  });

  test('explains when no positions or sources have been defined', async () => {
    fakeBackend();
    open('/candidates');

    expect(await screen.findByText(/No positions or sources have been defined yet/)).toBeTruthy();
    expect(screen.getByLabelText('Position').options).toHaveLength(1);
  });

  test('pages through a long list', async () => {
    const backend = fakeBackend({
      candidates: Array.from({ length: 25 }, (_, i) => sampleCandidate(i + 1)),
    });
    open('/candidates');

    expect(await screen.findByText('Showing 1–20 of 25')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Previous' }).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));

    expect(await screen.findByText('Showing 21–25 of 25')).toBeTruthy();
    expect(screen.getByText('Sample Person 25')).toBeTruthy();
    expect(callsTo(backend, 'GET', '/api/candidates').at(-1).query.page).toBe('2');
  });

  test('Add Candidate leads to the form', async () => {
    fakeBackend();
    open('/candidates');

    // One link in the sidebar and one button on the page; both lead to the form.
    const links = await screen.findAllByRole('link', { name: 'Add Candidate' });
    expect(links.some((link) => link.className.includes('button--primary'))).toBe(true);
    expect(links.every((link) => link.getAttribute('href') === '/candidates/new')).toBe(true);
  });
});

describe('add candidate', () => {
  test('shows the fields from the task guide with an enabled Save button', async () => {
    fakeBackend({ positions: [{ id: 7, name: 'Test Position', isActive: true }] });
    open('/candidates/new');

    for (const label of [
      /^Candidate ID/,
      /^Name/,
      'Phone',
      'Email',
      'Address',
      'O/L Maths',
      'A/L Result',
      'A/L Stream',
      'Other Education',
      'Applied Position',
      'Source',
      'CV Link',
      'Company CV Link',
      'HR Comment',
    ]) {
      expect(await screen.findByLabelText(label)).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(false);
    expect(
      within(screen.getByLabelText('Applied Position')).getByText('Test Position'),
    ).toBeTruthy();
  });

  test('stops an empty form before anything is sent, and names the missing fields', async () => {
    const backend = fakeBackend();
    open('/candidates/new');
    await screen.findByLabelText(/^Name/);

    save();

    expect(await screen.findByText('Candidate ID is required.')).toBeTruthy();
    expect(screen.getByText('Name is required.')).toBeTruthy();
    expect(screen.getByLabelText(/^Name/).getAttribute('aria-invalid')).toBe('true');
    expect(callsTo(backend, 'POST', '/api/candidates')).toHaveLength(0);
  });

  test('catches a badly formed phone, email and link', async () => {
    const backend = fakeBackend();
    open('/candidates/new');
    await screen.findByLabelText(/^Name/);

    type(/^Candidate ID/, 'TEST-900');
    type(/^Name/, 'Sample Person');
    type('Phone', '12345');
    type('Email', 'not-an-email');
    type('CV Link', 'files.example.test/cv.pdf');
    save();

    expect(await screen.findByText(/Phone must be 9 to 15 digits/)).toBeTruthy();
    expect(screen.getByText('Email is not a valid address.')).toBeTruthy();
    expect(screen.getByText(/CV Link must be a web address/)).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/candidates')).toHaveLength(0);
  });

  test('saves a new candidate and opens their details', async () => {
    const backend = fakeBackend({ positions: [{ id: 7, name: 'Test Position', isActive: true }] });
    open('/candidates/new');
    await screen.findByLabelText(/^Name/);

    type(/^Candidate ID/, 'TEST-901');
    type(/^Name/, 'New Sample Person');
    type('Phone', '077 123 4567');
    type('Email', 'new.sample@example.test');
    fireEvent.change(screen.getByLabelText('Applied Position'), { target: { value: '7' } });
    save();

    expect(await screen.findByText('Candidate added.')).toBeTruthy();
    expect(currentPath()).toMatch(/^\/candidates\/\d+$/);
    expect(await screen.findByText('New Sample Person')).toBeTruthy();
    expect(screen.getByText('0771234567')).toBeTruthy();

    const sent = callsTo(backend, 'POST', '/api/candidates')[0].body;
    expect(sent.phone).toBe('077 123 4567'); // sent as text; the backend tidies it
    expect(typeof sent.phone).toBe('string');
    expect(sent.positionId).toBe(7);
    expect(sent.sourceId).toBeNull();
    expect(sent.confirmDuplicate).toBe(false);
  });

  test('shows the errors the backend sends back, and saves nothing', async () => {
    const backend = fakeBackend({ candidates: [sampleCandidate(1)] });
    open('/candidates/new');
    await screen.findByLabelText(/^Name/);

    type(/^Candidate ID/, 'TEST-001'); // already used by Sample Person 1
    type(/^Name/, 'Another Person');
    save();

    expect(
      await screen.findByText('This Candidate ID is already used by another candidate.'),
    ).toBeTruthy();
    expect(screen.getByText('Some fields need correcting. Nothing was saved.')).toBeTruthy();
    expect(currentPath()).toBe('/candidates/new');
    expect(backend.candidates).toHaveLength(1);
  });

  test('warns about a likely duplicate without saving, then saves only after confirming', async () => {
    const backend = fakeBackend({ candidates: [sampleCandidate(1, { phone: '0771112222' })] });
    open('/candidates/new');
    await screen.findByLabelText(/^Name/);

    type(/^Candidate ID/, 'TEST-902');
    type(/^Name/, 'Possibly The Same');
    type('Phone', '+94 77 111 2222');
    save();

    const warning = await screen.findByRole('alert');
    expect(warning.textContent).toContain('This may be a duplicate. Nothing has been saved yet.');
    expect(
      within(warning)
        .getByRole('link', { name: 'TEST-001 — Sample Person 1' })
        .getAttribute('href'),
    ).toBe('/candidates/1');
    expect(warning.textContent).toContain('Same phone');
    expect(backend.candidates).toHaveLength(1);
    expect(currentPath()).toBe('/candidates/new');

    fireEvent.click(screen.getByRole('button', { name: 'Save as a separate candidate' }));

    expect(await screen.findByText('Candidate added.')).toBeTruthy();
    expect(backend.candidates).toHaveLength(2);
    expect(
      callsTo(backend, 'POST', '/api/candidates').map((call) => call.body.confirmDuplicate),
    ).toEqual([false, true]);
    // The first record was not touched or merged.
    expect(backend.candidates[0].fullName).toBe('Sample Person 1');
  });

  test('"Go back and review" closes the warning and saves nothing', async () => {
    const backend = fakeBackend({ candidates: [sampleCandidate(1, { phone: '0771112222' })] });
    open('/candidates/new');
    await screen.findByLabelText(/^Name/);

    type(/^Candidate ID/, 'TEST-903');
    type(/^Name/, 'Possibly The Same');
    type('Phone', '0771112222');
    save();
    await screen.findByRole('alert');

    fireEvent.click(screen.getByRole('button', { name: 'Go back and review' }));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(backend.candidates).toHaveLength(1);
    expect(screen.getByLabelText(/^Name/).value).toBe('Possibly The Same');
  });

  test('explains when the position list is empty', async () => {
    fakeBackend();
    open('/candidates/new');

    expect(await screen.findByText(/No positions have been defined yet/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' }).disabled).toBe(false);
  });
});

describe('candidate details', () => {
  test('shows the candidate from the backend', async () => {
    fakeBackend({
      positions: [{ id: 7, name: 'Test Position', isActive: true }],
      candidates: [
        sampleCandidate(1, {
          positionId: 7,
          position: { id: 7, name: 'Test Position' },
          address: '12 Example Road',
          cvUrl: 'https://files.example.test/cv/1.pdf',
          hrComment: 'Sample comment',
        }),
      ],
    });
    open('/candidates/1');

    expect(await screen.findByText('Sample Person 1')).toBeTruthy();
    expect(screen.getByText('0710000001')).toBeTruthy();
    expect(screen.getByText('Test Position')).toBeTruthy();
    expect(screen.getByText('12 Example Road')).toBeTruthy();
    expect(screen.getByText('Not sent')).toBeTruthy();
    expect(screen.getByText('Sample comment')).toBeTruthy();

    const link = screen.getByRole('link', { name: 'https://files.example.test/cv/1.pdf' });
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getByRole('link', { name: 'Edit Candidate' }).getAttribute('href')).toBe(
      '/candidates/1/edit',
    );
  });

  test('shows "--" for anything not filled in', async () => {
    fakeBackend({ candidates: [sampleCandidate(1, { phone: null, email: null })] });
    open('/candidates/1');
    await screen.findByText('Sample Person 1');

    const phoneRow = screen.getByText('Phone').closest('div');
    expect(within(phoneRow).getByText('--')).toBeTruthy();
  });

  test('says so when the candidate does not exist', async () => {
    fakeBackend();
    open('/candidates/999');

    expect(await screen.findByText('Candidate not found')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Edit Candidate' })).toBeNull();
  });
});

describe('edit candidate', () => {
  test('loads the current values, saves the change and confirms it', async () => {
    const backend = fakeBackend({ candidates: [sampleCandidate(1, { olMaths: 'B' })] });
    open('/candidates/1/edit');

    await waitFor(() => expect(screen.getByLabelText(/^Name/).value).toBe('Sample Person 1'));
    expect(screen.getByLabelText(/^Candidate ID/).value).toBe('TEST-001');
    expect(screen.getByLabelText('Phone').value).toBe('0710000001');
    expect(screen.getByLabelText('O/L Maths').value).toBe('B');

    type('O/L Maths', 'A');
    type('HR Comment', 'Updated sample comment');
    save();

    expect(await screen.findByText('Changes saved.')).toBeTruthy();
    expect(currentPath()).toBe('/candidates/1');
    expect(await screen.findByText('Updated sample comment')).toBeTruthy();

    const sent = callsTo(backend, 'PUT', '/api/candidates/1')[0].body;
    expect(sent.olMaths).toBe('A');
    expect(sent.fullName).toBe('Sample Person 1');
    expect(sent.phone).toBe('0710000001');
  });

  test('validates before sending', async () => {
    const backend = fakeBackend({ candidates: [sampleCandidate(1)] });
    open('/candidates/1/edit');
    await waitFor(() => expect(screen.getByLabelText(/^Name/).value).toBe('Sample Person 1'));

    type(/^Name/, '  ');
    save();

    expect(await screen.findByText('Name is required.')).toBeTruthy();
    expect(callsTo(backend, 'PUT', '/api/candidates/1')).toHaveLength(0);
  });

  test('runs the duplicate check again on a change', async () => {
    const backend = fakeBackend({
      candidates: [sampleCandidate(1, { phone: '0771112222' }), sampleCandidate(2)],
    });
    open('/candidates/2/edit');
    await waitFor(() => expect(screen.getByLabelText(/^Name/).value).toBe('Sample Person 2'));

    type('Phone', '0771112222');
    save();

    expect((await screen.findByRole('alert')).textContent).toContain('This may be a duplicate');
    expect(backend.candidates[1].phone).toBe('0710000002');
  });

  test('says so when the candidate does not exist', async () => {
    fakeBackend();
    open('/candidates/999/edit');

    expect(await screen.findByText('Candidate not found')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});

describe('CV / documents', () => {
  test('shows the CV links and says uploading is waiting for approval', async () => {
    fakeBackend({
      candidates: [sampleCandidate(1, { cvUrl: 'https://files.example.test/cv/1.pdf' })],
    });
    open('/candidates/1/documents');

    expect(await screen.findByText(/CV storage method pending approval/)).toBeTruthy();
    expect(
      await screen.findByRole('link', { name: 'https://files.example.test/cv/1.pdf' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload document' }).disabled).toBe(true);
  });
});

describe('positions and sources', () => {
  test('start empty, and an added position appears in the list', async () => {
    const backend = fakeBackend();
    open('/admin/lookups');

    expect(await screen.findByText('No positions yet')).toBeTruthy();
    type('New position', 'Test Position');
    fireEvent.click(screen.getByRole('button', { name: 'Add position' }));

    expect(await screen.findByText('Test Position')).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/lookups/positions')[0].body).toEqual({
      name: 'Test Position',
    });
    expect(screen.getByLabelText('New position').value).toBe('');
  });

  test('a blank name is stopped before anything is sent', async () => {
    const backend = fakeBackend();
    open('/admin/lookups');
    await screen.findByText('No sources yet');

    fireEvent.click(screen.getByRole('button', { name: 'Add source' }));

    expect(await screen.findByText('Enter a source name.')).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/lookups/sources')).toHaveLength(0);
  });
});

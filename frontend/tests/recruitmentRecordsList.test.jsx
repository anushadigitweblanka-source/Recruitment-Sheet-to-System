// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.jsx';
import { AuthContext } from '../src/auth/AuthContext.jsx';
import { allPages } from '../src/navigation.js';

// The Historical Interviews page. Every name and number is made up.

const as = (permissions) => ({
  status: 'authenticated',
  user: {
    id: 1,
    email: 'test.user@example.test',
    fullName: 'Test User',
    role: { code: 'hr', name: 'HR' },
    permissions,
  },
  login: async () => ({ ok: true }),
  logout: async () => ({ ok: true }),
});

const record = (id, overrides = {}) => ({
  id,
  batchId: 1,
  recordNumber: id + 1,
  interviewDateText: '04/11/2026 14:30',
  interviewOn: '2026-11-04',
  candidateName: `Hist Sample ${id}`,
  contactNumber: `077000000${id}`,
  source: 'Fictional Board',
  mode: 'Onsite',
  position: 'Sample Position A',
  originalStatus: 'Selected',
  remarks: `Remark ${id}`,
  extraValue: null,
  reviewFlags: [],
  ...overrides,
});

const ITEMS = [
  record(1),
  record(2, {
    contactNumber: '771222222',
    originalStatus: 'Rejected',
    reviewFlags: ['phone_unusual'],
  }),
  record(3, {
    interviewDateText: null,
    interviewOn: null,
    source: null,
    reviewFlags: ['date_missing'],
  }),
];

// The Recruitment Records list: one live candidate, then imported records.
const toRecord = (item) => ({
  kind: 'historical',
  id: item.id,
  candidateId: null,
  candidateName: item.candidateName,
  contactNumber: item.contactNumber,
  position: item.position,
  source: item.source,
  date: item.interviewDateText,
  mode: item.mode,
  status: item.originalStatus,
  remarks: item.remarks,
  extraValue: item.extraValue,
  recordNumber: item.recordNumber,
  reviewFlags: item.reviewFlags,
});
const RECORDS = [
  {
    kind: 'candidate',
    id: 91,
    candidateId: 'S11-0091',
    candidateName: 'Registration Sample One',
    contactNumber: '0761234567',
    position: 'Sample Position A',
    source: 'Fictional Board',
    date: '2026-10-16',
    mode: null,
    status: 'Applied',
    remarks: null,
    extraValue: null,
    recordNumber: null,
    reviewFlags: [],
  },
  ...ITEMS.slice(0, 2).map(toRecord),
];

function fakeBackend({
  items = ITEMS,
  listStatus = 200,
  summaryStatus = 200,
  records = RECORDS,
  recordsStatus = 200,
  hang = false,
} = {}) {
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (address) => {
      const url = new URL(address, 'http://test.local');
      const path = url.pathname.replace('/api', '');
      calls.push({ path, query: Object.fromEntries(url.searchParams) });

      if (path === '/historical-interviews') {
        if (hang) return new Promise(() => {});
        if (listStatus !== 200) return json({ error: 'x' }, listStatus);
        return json({ items, total: items.length, page: 1, pageSize: 25 });
      }
      if (path === '/historical-interviews/summary') {
        if (summaryStatus !== 200) return json({ error: 'x' }, summaryStatus);
        return json({ records: 404, needingReview: 31, batches: [{ id: 1 }] });
      }
      if (path === '/historical-interviews/options') {
        return json({
          statuses: [
            { value: 'Selected', count: 2 },
            { value: 'Rejected', count: 1 },
            { value: null, count: 1 },
          ],
          sources: [{ value: 'Fictional Board', count: 2 }],
          modes: [{ value: 'Onsite', count: 3 }],
          positions: [
            { value: 'Sample Position A', count: 2 },
            { value: 'Sample Position B', count: 1 },
          ],
          flags: [{ flag: 'phone_unusual', count: 1 }],
        });
      }
      if (path === '/recruitment-records') {
        if (recordsStatus !== 200) return json({ error: 'x' }, recordsStatus);
        return json({ items: records, total: records.length, page: 1, pageSize: 25 });
      }
      if (path === '/recruitment-records/options') {
        return json({
          positions: [
            { value: 'Sample Position A', count: 2 },
            { value: null, count: 1 },
          ],
          sources: [{ value: 'Fictional Board', count: 3 }],
          statuses: [
            { value: 'Applied', count: 1 },
            { value: 'Selected', count: 1 },
          ],
        });
      }
      if (path === '/lookups/positions') {
        return json({ items: [{ id: 7, name: 'Sample Position A' }] });
      }
      if (path === '/lookups/sources') return json({ items: [{ id: 8, name: 'Fictional Board' }] });
      if (path === '/lookups/stages') {
        return json({ items: [{ code: 'applied', name: 'Applied' }] });
      }
      if (path === '/candidates') {
        return json({ items: [], total: 4, page: 1, pageSize: 1 });
      }
      return json({ error: 'not_found' }, 404);
    }),
  );
  return calls;
}

const open = (permissions = ['candidates.view', 'historical.view'], path = '/candidates') =>
  render(
    <AuthContext.Provider value={as(permissions)}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthContext.Provider>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the standalone Historical Interviews page is gone', () => {
  test('is not in the sidebar for anyone, including people with historical.view', async () => {
    fakeBackend();
    open(['candidates.view', 'historical.view'], '/dashboard');
    await screen.findAllByRole('link', { name: 'Candidate List' });
    expect(screen.queryByRole('link', { name: /historical interviews/i })).toBeNull();
    expect(screen.queryByText('Historical Data')).toBeNull();
    expect(allPages.some((page) => page.path === '/historical-interviews')).toBe(false);
  });

  test('an old bookmark opens the Candidate List, where the records are', async () => {
    fakeBackend();
    open(['candidates.view', 'historical.view'], '/historical-interviews');
    const table = await screen.findByRole('table', { name: 'Recruitment records' });
    expect(within(table).getByText('Hist Sample 1')).toBeTruthy();
    expect(screen.queryByText('Page not found')).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Add Candidate' }).length).toBeGreaterThan(0);
  });

  test('the old address is no longer a page of its own for someone without historical access', async () => {
    const calls = fakeBackend();
    open(['candidates.view'], '/historical-interviews');
    await screen.findAllByRole('link', { name: 'Add Candidate' });
    expect(screen.queryByRole('table', { name: 'Recruitment records' })).toBeNull();
    expect(calls.some((c) => c.path.startsWith('/historical-interviews'))).toBe(false);
  });
});

describe('Candidate List: one Recruitment Records list', () => {
  const openList = async () => {
    const calls = fakeBackend();
    open(['candidates.view', 'historical.view'], '/candidates');
    const table = await screen.findByRole('table', { name: 'Recruitment records' });
    return { calls, table };
  };

  test('has no record-type or view tabs, only the one list and Add Candidate', async () => {
    const { table } = await openList();
    expect(table).toBeTruthy();
    expect(screen.queryByRole('group', { name: /candidate list view|record type/i })).toBeNull();
    expect(
      screen.queryByRole('button', { name: /historical interview records|new candidate/i }),
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: /development candidates|real recruitment/i }),
    ).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Add Candidate' }).length).toBeGreaterThan(0);
  });

  test('shows live candidates and imported records together, exactly as stored', async () => {
    const { table } = await openList();
    // The columns: nothing beyond the fields already in use.
    for (const label of [
      'Candidate ID',
      'Candidate Name',
      'Contact Number',
      'Position',
      'Source',
      'Date',
      'Mode',
      'Status',
      'Remarks',
      'Review',
      'Actions',
    ]) {
      expect(within(table).getByRole('columnheader', { name: label })).toBeTruthy();
    }
    // A live candidate, with its Candidate ID and current status.
    expect(within(table).getByText('Registration Sample One')).toBeTruthy();
    expect(within(table).getByRole('link', { name: 'S11-0091' }).getAttribute('href')).toBe(
      '/candidates/91',
    );
    expect(within(table).getByText('Applied')).toBeTruthy();
    // Imported records, with their original values; a lost zero is not repaired.
    expect(within(table).getByText('Hist Sample 1')).toBeTruthy();
    expect(within(table).getByText('771222222')).toBeTruthy();
    expect(within(table).getByText('Phone looks unusual')).toBeTruthy();
    // No Candidate ID is invented for an imported record.
    expect(within(table).getAllByText('--').length).toBeGreaterThan(0);
  });

  test('a live candidate has View and Edit; an imported record has only Details', async () => {
    const { table } = await openList();
    expect(
      within(table)
        .getByRole('link', { name: 'View Registration Sample One' })
        .getAttribute('href'),
    ).toBe('/candidates/91');
    expect(
      within(table)
        .getByRole('link', { name: 'Edit Registration Sample One' })
        .getAttribute('href'),
    ).toBe('/candidates/91/edit');
    expect(within(table).getAllByRole('button', { name: /Details for record/ }).length).toBe(2);
    expect(within(table).queryByRole('link', { name: /Edit Hist Sample/ })).toBeNull();
  });

  test('opens the full stored record from Details, read only', async () => {
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'Details for record 3' }));
    const details = await screen.findByRole('region', { name: 'Historical record details' });
    expect(within(details).getByText('Remark 2')).toBeTruthy();
    expect(within(details).getByText('Phone looks unusual')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /edit|delete|import|send|convert|create/i }),
    ).toBeNull();
  });

  test('search, position, source and status filters are sent to the server', async () => {
    const { calls } = await openList();
    await screen.findByRole('option', { name: 'Sample Position A (2)' });

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Sample 2' } });
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'Sample Position A' } });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'Fictional Board' } });
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'Applied' } });
    await waitFor(() => {
      const last = calls.filter((c) => c.path === '/recruitment-records').at(-1).query;
      expect(last).toMatchObject({
        search: 'Sample 2',
        position: 'Sample Position A',
        source: 'Fictional Board',
        status: 'Applied',
        page: '1',
      });
    });

    // A blank cell can be chosen too.
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: '__none' } });
    await waitFor(() =>
      expect(calls.filter((c) => c.path === '/recruitment-records').at(-1).query.position).toBe(
        '__none',
      ),
    );
  });

  test('says so when there is nothing yet, and when it cannot be loaded', async () => {
    fakeBackend({ records: [] });
    open(['candidates.view', 'historical.view'], '/candidates');
    expect(await screen.findByText('No recruitment records yet')).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();

    fakeBackend({ recordsStatus: 500 });
    open(['candidates.view', 'historical.view'], '/candidates');
    expect(await screen.findByText('The recruitment records could not be loaded')).toBeTruthy();
  });

  test('without historical.view the normal candidate list is unchanged and no history is requested', async () => {
    const calls = fakeBackend();
    open(['candidates.view'], '/candidates');
    await screen.findAllByRole('link', { name: 'Add Candidate' });
    expect(await screen.findByText('No candidates yet')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Recruitment records' })).toBeNull();
    expect(calls.some((c) => c.path.startsWith('/historical-interviews'))).toBe(false);
    expect(calls.some((c) => c.path.startsWith('/recruitment-records'))).toBe(false);
  });
});

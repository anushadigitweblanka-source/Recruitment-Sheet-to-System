// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
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
  onRequest = () => undefined,
} = {}) {
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (address) => {
      const url = new URL(address, 'http://test.local');
      const path = url.pathname.replace('/api', '');
      calls.push({ path, query: Object.fromEntries(url.searchParams) });
      const custom = onRequest(path, Object.fromEntries(url.searchParams));
      if (custom) return custom;

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
  const openList = async (permissions = ['candidates.view', 'historical.view']) => {
    const calls = fakeBackend();
    open(permissions, '/candidates');
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

  test('a live candidate has View Details and Edit; an imported record has only View Details', async () => {
    const { table } = await openList(['candidates.view', 'candidates.edit', 'historical.view']);
    expect(
      within(table)
        .getByRole('link', { name: 'View details of Registration Sample One' })
        .getAttribute('href'),
    ).toBe('/candidates/91');
    expect(
      within(table)
        .getByRole('link', { name: 'Edit Registration Sample One' })
        .getAttribute('href'),
    ).toBe('/candidates/91/edit');
    expect(within(table).getAllByRole('button', { name: /View details of record/ }).length).toBe(2);
    expect(within(table).queryByRole('link', { name: /Edit Hist Sample/ })).toBeNull();
  });

  test('opens the full stored record from View Details, read only', async () => {
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'View details of record 3' }));
    const details = await screen.findByRole('region', { name: 'Historical record details' });
    expect(within(details).getByText('Remark 2')).toBeTruthy();
    expect(within(details).getByText('Phone looks unusual')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /edit|delete|import|send|convert|create/i }),
    ).toBeNull();
  });

  test('/candidates renders Actions as the last column, right after Review, in every row', async () => {
    const { table } = await openList(['candidates.view', 'candidates.edit', 'historical.view']);
    const headings = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent);
    expect(headings).toEqual([
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
    ]);
    const actionsHeading = within(table).getByRole('columnheader', { name: 'Actions' });
    // Pinned to the right edge, so a wide table cannot push it out of sight.
    expect(actionsHeading.className).toContain('data-table__sticky-end');

    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      const cells = within(row).getAllByRole('cell');
      expect(cells).toHaveLength(11);
      expect(cells[10].className).toContain('data-table__sticky-end');
      expect(within(cells[10]).queryByText('View Details')).toBeTruthy();
    }
    // A registered candidate: View Details and Edit. Imported rows: View Details only.
    const [candidateRow, ...importedRows] = rows;
    expect(within(candidateRow).getByText('Edit')).toBeTruthy();
    for (const row of importedRows) expect(within(row).queryByText('Edit')).toBeNull();
  });

  test('a user who may not edit sees View Details but no Edit link', async () => {
    fakeBackend();
    open(['candidates.view', 'historical.view'], '/candidates');
    const table = await screen.findByRole('table', { name: 'Recruitment records' });
    expect(within(table).getByRole('link', { name: /View details of Registration/ })).toBeTruthy();
    expect(within(table).queryByRole('link', { name: /^Edit / })).toBeNull();
    cleanup();

    fakeBackend();
    open(['candidates.view', 'candidates.edit', 'historical.view'], '/candidates');
    const editable = await screen.findByRole('table', { name: 'Recruitment records' });
    expect(
      within(editable).getByRole('link', { name: 'Edit Registration Sample One' }),
    ).toBeTruthy();
  });

  test('the imported record details show every stored value and no fictional Candidate ID', async () => {
    await openList();
    fireEvent.click(screen.getByRole('button', { name: 'View details of record 2' }));
    const details = await screen.findByRole('region', { name: 'Historical record details' });
    for (const text of [
      '04/11/2026 14:30',
      'Hist Sample 1',
      '0770000001',
      'Sample Position A',
      'Fictional Board',
      'Onsite',
      'Selected',
      'Remark 1',
    ]) {
      expect(within(details).getByText(text)).toBeTruthy();
    }
    expect(within(details).queryByText(/Candidate ID/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('region', { name: 'Historical record details' })).toBeNull();
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

// Clicking View Details has to show the record where the person is looking.
// With 25 rows on a page, a panel placed after the table is off screen, so
// these tests click the buttons and check where the panel is, what has focus
// and what was scrolled into view - not only that the panel exists.
describe('Candidate List: View Details by clicking', () => {
  const PERMISSIONS = ['candidates.view', 'historical.view'];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const many = (from, count) =>
    Array.from({ length: count }, (_, i) =>
      toRecord(record(from + i, { candidateName: `Row Sample ${from + i}` })),
    );
  let scrolled;

  beforeEach(() => {
    scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
  });
  afterEach(() => {
    delete Element.prototype.scrollIntoView;
  });

  const openRows = async (options = {}) => {
    const calls = fakeBackend(options);
    open(PERMISSIONS, '/candidates');
    const table = await screen.findByRole('table', { name: 'Recruitment records' });
    return { calls, table };
  };
  const panel = () => screen.queryByRole('region', { name: 'Historical record details' });
  const heading = (name) => within(panel()).getByRole('heading', { name });

  test('a registered candidate opens its own profile by database ID', async () => {
    const { calls } = await openRows({
      onRequest: (path) =>
        path === '/candidates/91'
          ? json({
              candidate: {
                id: 91,
                candidateCode: 'S11-0091',
                fullName: 'Registration Sample One',
                stage: { code: 'applied', name: 'Applied' },
                phone: '0761234567',
              },
            })
          : undefined,
    });
    fireEvent.click(screen.getByRole('link', { name: 'View details of Registration Sample One' }));

    expect(await screen.findByText('Loading candidate…')).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('Registration Sample One').length).toBe(1));
    expect(screen.getByText('S11-0091')).toBeTruthy();
    // The database ID (91) is requested, never the Candidate ID text.
    expect(calls.some((c) => c.path === '/candidates/91')).toBe(true);
    expect(calls.some((c) => c.path.includes('S11-0091'))).toBe(false);
    expect(panel()).toBeNull();
  });

  test('an imported record shows its details above the table, scrolled to and focused', async () => {
    const { table } = await openRows();
    fireEvent.click(screen.getByRole('button', { name: 'View details of record 3' }));

    const details = await screen.findByRole('region', { name: 'Historical record details' });
    expect(within(details).getByText('Remark 2')).toBeTruthy();
    // Before the table, so it is in view without scrolling past every row.
    expect(details.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(scrolled).toHaveBeenCalled();
    expect(scrolled.mock.contexts.at(-1)).toBe(details);
    // Focus moves to the panel heading, for keyboard and screen reader users.
    expect(document.activeElement).toBe(heading('Historical record 3'));
  });

  test('clicking another row shows that row, never the previous one', async () => {
    await openRows();
    fireEvent.click(screen.getByRole('button', { name: 'View details of record 2' }));
    await screen.findByRole('region', { name: 'Historical record details' });
    expect(within(panel()).getByText('Remark 1')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'View details of record 3' }));
    await waitFor(() => expect(heading('Historical record 3')).toBeTruthy());
    expect(screen.getAllByRole('region', { name: 'Historical record details' }).length).toBe(1);
    expect(within(panel()).getByText('Remark 2')).toBeTruthy();
    expect(within(panel()).queryByText('Remark 1')).toBeNull();
    expect(document.activeElement).toBe(heading('Historical record 3'));
  });

  test('works after filtering and after changing page, and never shows a stale record', async () => {
    const page1 = many(1, 25);
    const page2 = many(26, 5);
    const filtered = [
      toRecord(record(77, { candidateName: 'Filtered Sample', remarks: 'Only me' })),
    ];
    const { calls } = await openRows({
      onRequest: (path, query) => {
        if (path !== '/recruitment-records') return undefined;
        if (query.position) return json({ items: filtered, total: 1, page: 1, pageSize: 25 });
        const second = query.page === '2';
        return json({
          items: second ? page2 : page1,
          total: 30,
          page: second ? 2 : 1,
          pageSize: 25,
        });
      },
    });

    // Page 1, row 5 (record number 6).
    fireEvent.click(await screen.findByRole('button', { name: 'View details of record 6' }));
    await screen.findByRole('region', { name: 'Historical record details' });
    expect(within(panel()).getByText('Remark 5')).toBeTruthy();

    // Next page: the old panel is gone, and a row there shows its own values.
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Row Sample 26');
    expect(panel()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View details of record 27' }));
    await screen.findByRole('region', { name: 'Historical record details' });
    expect(within(panel()).getByText('Remark 26')).toBeTruthy();

    // A filter: the panel is cleared, and the filtered row opens correctly.
    fireEvent.change(screen.getByLabelText('Position'), { target: { value: 'Sample Position A' } });
    await screen.findByText('Filtered Sample');
    expect(panel()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'View details of record 78' }));
    await screen.findByRole('region', { name: 'Historical record details' });
    expect(within(panel()).getByText('Only me')).toBeTruthy();
    expect(calls.some((c) => c.path === '/recruitment-records' && c.query.page === '2')).toBe(true);
  });

  test('imported records stay read only: no writes, no links or edit actions in the panel', async () => {
    await openRows();
    fireEvent.click(screen.getByRole('button', { name: 'View details of record 2' }));
    const details = await screen.findByRole('region', { name: 'Historical record details' });

    expect(within(details).queryAllByRole('link')).toEqual([]);
    expect(
      within(details)
        .queryAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Close details']);
    // Every request so far is a plain read.
    const writes = fetch.mock.calls.filter(([, init]) => init?.method && init.method !== 'GET');
    expect(writes).toEqual([]);
    // No link to a candidate profile built from a historical record ID.
    const hrefs = [...document.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs.some((href) => /\/candidates\/[23](\/|$)/.test(href))).toBe(false);
  });

  test('Close details hides the panel and returns focus to the button that opened it', async () => {
    await openRows();
    const button = screen.getByRole('button', { name: 'View details of record 2' });
    fireEvent.click(button);
    await screen.findByRole('region', { name: 'Historical record details' });

    fireEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(panel()).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  test('says so when the records are denied or cannot be loaded, and offers no details', async () => {
    fakeBackend({ recordsStatus: 403 });
    open(PERMISSIONS, '/candidates');
    expect(
      await screen.findByText('You do not have permission to view recruitment records'),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /View details of record/ })).toBeNull();
    cleanup();
    vi.unstubAllGlobals();

    fakeBackend({ recordsStatus: 500 });
    open(PERMISSIONS, '/candidates');
    expect(await screen.findByText('The recruitment records could not be loaded')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

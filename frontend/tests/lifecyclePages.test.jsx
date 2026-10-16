// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.jsx';
import { AuthContext } from '../src/auth/AuthContext.jsx';

// The Employee Lifecycle pages with employees in every phase and exit state, in
// the shape the server returns them. The fake server filters exactly as the real
// one does (phase, status, and "exited" = discontinued or terminated). Every
// name is made up.

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

const employee = (id, name, currentPhase, status = 'active', extra = {}) => ({
  id,
  candidate: { id: id + 100, candidateCode: `LIFE-${id}`, fullName: name },
  position: 'Sample Position',
  joinDate: '2026-10-14',
  track: null,
  currentPhase,
  phaseStart: '2026-10-14',
  phaseEnd: currentPhase === 'senior' || currentPhase === 'junior' ? null : '2026-10-20',
  status,
  nextReview: status === 'active' && currentPhase !== 'senior' ? '2026-10-20' : null,
  ...extra,
});

const EMPLOYEES = [
  employee(1, 'Lifecycle Eval One', 'evaluation'),
  employee(2, 'Lifecycle Eval Two', 'evaluation'),
  employee(3, 'Lifecycle Probation', 'probation'),
  employee(4, 'Lifecycle Junior', 'junior'),
  employee(5, 'Lifecycle Senior', 'senior'),
  employee(6, 'Lifecycle Discontinued', 'probation', 'discontinued'),
  employee(7, 'Lifecycle Terminated', 'senior', 'terminated'),
];

const SELECTED = [
  {
    id: 1,
    batchId: 1,
    recordNumber: 2,
    interviewDateText: '04/11/2026',
    interviewOn: '2026-11-04',
    candidateName: 'Hist Selected One',
    contactNumber: '0770000001',
    source: 'Fictional Board',
    mode: 'Onsite',
    position: 'Sample Position',
    originalStatus: 'Selected',
    remarks: null,
    extraValue: null,
    reviewFlags: [],
  },
];

function fakeBackend() {
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (address) => {
      const url = new URL(address, 'http://test.local');
      const path = url.pathname.replace('/api', '');
      const query = Object.fromEntries(url.searchParams);
      calls.push({ path, query });
      if (path === '/employees') {
        let found = EMPLOYEES;
        if (query.phase) found = found.filter((e) => e.currentPhase === query.phase);
        if (query.status === 'exited') found = found.filter((e) => e.status !== 'active');
        else if (query.status) found = found.filter((e) => e.status === query.status);
        return json({ items: found, total: found.length, page: 1, pageSize: 20 });
      }
      if (path === '/historical-interviews') {
        return json({ items: SELECTED, total: 145, page: 1, pageSize: 10 });
      }
      if (path === '/historical-interviews/options') {
        return json({ statuses: [], sources: [], modes: [], positions: [], flags: [] });
      }
      return json({}, 404);
    }),
  );
  return calls;
}

const open = (path, permissions = ['candidates.view', 'historical.view']) =>
  render(
    <AuthContext.Provider value={as(permissions)}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthContext.Provider>,
  );

const namesIn = (table) =>
  within(table)
    .queryAllByRole('link')
    .map((link) => link.textContent)
    .filter((text) => text.startsWith('Lifecycle '));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PAGES = [
  ['/employees/phase/evaluation', 'Evaluation', ['Lifecycle Eval One', 'Lifecycle Eval Two']],
  ['/employees/phase/probation', 'Probation', ['Lifecycle Probation']],
  ['/employees/phase/junior', 'Junior Stage', ['Lifecycle Junior']],
  ['/employees/phase/senior', 'Senior Stage', ['Lifecycle Senior']],
  [
    '/employees/phase/exits',
    'Discontinued / Exit',
    ['Lifecycle Discontinued', 'Lifecycle Terminated'],
  ],
];

describe('each lifecycle page shows the stored employees for its phase or outcome', () => {
  for (const [path, caption, expected] of PAGES) {
    test(`${caption}: ${expected.length} employee${expected.length === 1 ? '' : 's'}`, async () => {
      const calls = fakeBackend();
      open(path);
      const table = await screen.findByRole('table', { name: caption });
      expect([...new Set(namesIn(table))].sort()).toEqual([...expected].sort());
      // The page asks the server, with its own fixed filters.
      expect(calls.filter((c) => c.path === '/employees').length).toBeGreaterThan(0);
      // Selected interview records are never listed as employees, and not asked for here.
      expect(within(table).queryByText('Hist Selected One')).toBeNull();
      expect(calls.some((c) => c.path.startsWith('/historical-interviews'))).toBe(false);
    });
  }

  test('Employee List shows every verified employee; pending Selected records stay separate', async () => {
    const calls = fakeBackend();
    open('/employees');
    const employees = await screen.findByRole('table', { name: 'Employees' });
    expect([...new Set(namesIn(employees))].sort()).toEqual(
      EMPLOYEES.map((e) => e.candidate.fullName).sort(),
    );
    const pending = await screen.findByRole('table', { name: 'Joining verification pending' });
    expect(within(pending).getByText('Hist Selected One')).toBeTruthy();
    expect(within(employees).queryByText('Hist Selected One')).toBeNull();
    expect(within(pending).queryByText('Lifecycle Eval One')).toBeNull();
    // No employee list request ever asked for the historical status.
    expect(calls.filter((c) => c.path === '/employees').every((c) => !c.query.status)).toBe(true);
  });

  test('a page with nobody in it says so instead of showing other people', async () => {
    fakeBackend();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response(JSON.stringify({ items: [], total: 0, page: 1, pageSize: 20 })),
      ),
    );
    open('/employees/phase/probation');
    expect(await screen.findByText('No one is in probation now')).toBeTruthy();
    await waitFor(() => expect(screen.queryByText('Loading employees…')).toBeNull());
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.jsx';
import { AuthContext } from '../src/auth/AuthContext.jsx';

// Joining Verification Pending, in the Employee List. Every name and figure in
// this file is made up.

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

// One verified employee, as the employee list returns it.
const EMPLOYEES = [
  {
    id: 5,
    candidate: { id: 105, candidateCode: 'TEST-005', fullName: 'Verified Employee Sample' },
    position: 'Sample Position',
    joinDate: '2026-11-02',
    track: null,
    currentPhase: 'evaluation',
    phaseStart: '2026-11-02',
    phaseEnd: '2026-11-08',
    status: 'active',
    nextReview: '2026-11-08',
  },
];

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
  record(2, { contactNumber: '771222222', reviewFlags: ['phone_unusual'] }),
  record(3, { remarks: null, interviewDateText: null, interviewOn: null }),
];

function fakeBackend({ total = 23, listStatus = 200, items = ITEMS } = {}) {
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (address) => {
      const url = new URL(address, 'http://test.local');
      const path = url.pathname.replace('/api', '');
      calls.push({ path, query: Object.fromEntries(url.searchParams) });
      if (path === '/employees') {
        return json({ items: EMPLOYEES, total: EMPLOYEES.length, page: 1, pageSize: 20 });
      }
      if (path === '/historical-interviews') {
        if (listStatus !== 200) return json({ error: 'x' }, listStatus);
        return json({ items, total, page: 1, pageSize: 10 });
      }
      if (path === '/historical-interviews/options') {
        return json({
          statuses: [{ value: 'Selected', count: total }],
          sources: [{ value: 'Fictional Board', count: total }],
          modes: [{ value: 'Onsite', count: total }],
          positions: [{ value: 'Sample Position A', count: total }],
          flags: [],
        });
      }
      return json({}, 404);
    }),
  );
  return calls;
}

const open = (permissions = ['candidates.view', 'historical.view'], path = '/employees') =>
  render(
    <AuthContext.Provider value={as(permissions)}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthContext.Provider>,
  );

const historicalCalls = (calls) => calls.filter((c) => c.path === '/historical-interviews');
const VERIFICATION_TABLE = 'Joining verification pending';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Joining Verification Pending in the Employee List', () => {
  test('sits inside the Employee List, below the verified employees, clearly labelled', async () => {
    fakeBackend();
    open();
    const employees = await screen.findByRole('table', { name: 'Employees' });
    const pending = await screen.findByRole('table', { name: VERIFICATION_TABLE });
    expect(screen.getByRole('heading', { name: 'Joining Verification Pending' })).toBeTruthy();
    // The verified employee is in the employee table only.
    expect(within(employees).getByText('Verified Employee Sample')).toBeTruthy();
    expect(within(pending).queryByText('Verified Employee Sample')).toBeNull();
    expect(within(employees).queryByText('Hist Sample 1')).toBeNull();
    // Employees come first on the page.
    expect(
      employees.compareDocumentPosition(pending) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test('lists the Selected interview records with every requested field', async () => {
    fakeBackend();
    open();
    const table = await screen.findByRole('table', { name: VERIFICATION_TABLE });
    for (const label of [
      'Candidate Name',
      'Contact Number',
      'Position',
      'Interview Date',
      'Original Status',
      'Remarks',
    ]) {
      expect(within(table).getByRole('columnheader', { name: label })).toBeTruthy();
    }
    expect(within(table).getByText('Hist Sample 1')).toBeTruthy();
    expect(within(table).getByText('0770000001')).toBeTruthy();
    expect(within(table).getAllByText('Sample Position A').length).toBe(3);
    expect(within(table).getAllByText('04/11/2026 14:30').length).toBe(2);
    expect(within(table).getAllByText('Selected').length).toBe(3);
    expect(within(table).getByText('Remark 1')).toBeTruthy();
    // A lost zero is shown as it is; empty cells are dashes, not invented text.
    expect(within(table).getByText('771222222')).toBeTruthy();
    expect(within(table).getAllByText('--').length).toBeGreaterThan(0);
  });

  test('the total is the server count, requested for exactly the status Selected', async () => {
    const calls = fakeBackend({ total: 23 });
    open();
    expect((await screen.findByTestId('selected-total')).textContent).toContain(
      '23 Selected interview records in the imported log',
    );
    const first = historicalCalls(calls)[0].query;
    expect(first.status).toBe('Selected');
    expect(first.pageSize).toBe('10');
    expect(calls.find((c) => c.path === '/historical-interviews/options').query.status).toBe(
      'Selected',
    );
  });

  test('says Selected is not joined, and offers no way to make an employee', async () => {
    fakeBackend();
    open();
    await screen.findByRole('table', { name: VERIFICATION_TABLE });
    expect(screen.getByText(/does not mean the person joined/)).toBeTruthy();
    expect(screen.getByText(/records are never merged/)).toBeTruthy();
    expect(screen.getByText(/creates an employee, offer or notification/)).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /create|convert|add employee|make offer|join|import/i }),
    ).toBeNull();
    // The lifecycle overview and the verified employee table are untouched.
    expect(screen.getByText('Lifecycle phases')).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Employees' })).toBeTruthy();
  });

  test('search and filters are sent to the server and always keep status Selected', async () => {
    const calls = fakeBackend();
    open();
    await screen.findByRole('table', { name: VERIFICATION_TABLE });
    await screen.findByRole('option', { name: 'Sample Position A (23)' });

    fireEvent.change(screen.getByLabelText('Search selected records'), {
      target: { value: 'Sample 2' },
    });
    fireEvent.change(screen.getByLabelText('Selected position'), {
      target: { value: 'Sample Position A' },
    });
    fireEvent.change(screen.getByLabelText('Selected source'), {
      target: { value: 'Fictional Board' },
    });
    fireEvent.change(screen.getByLabelText('Selected mode'), { target: { value: 'Onsite' } });
    await waitFor(() => {
      expect(historicalCalls(calls).at(-1).query).toMatchObject({
        status: 'Selected',
        search: 'Sample 2',
        position: 'Sample Position A',
        source: 'Fictional Board',
        mode: 'Onsite',
        page: '1',
      });
    });
    expect((await screen.findByTestId('selected-total')).textContent).toContain('(filtered)');
  });

  test('Details is read only and explains how a joining is verified, without creating anything', async () => {
    fakeBackend();
    open();
    await screen.findByRole('table', { name: VERIFICATION_TABLE });
    fireEvent.click(screen.getByRole('button', { name: 'Details for historical record 3' }));
    const details = await screen.findByRole('region', {
      name: 'Historical selected record details',
    });
    expect(within(details).getByText('Remark 2')).toBeTruthy();
    expect(within(details).getByText('Phone looks unusual')).toBeTruthy();
    expect(within(details).getByText(/not a candidate profile or an employee/)).toBeTruthy();
    expect(
      within(details).getByText(/No joining date, Candidate ID or phase is filled in/),
    ).toBeTruthy();
    expect(within(details).getByRole('link', { name: 'Candidate List' }).getAttribute('href')).toBe(
      '/candidates',
    );
    fireEvent.click(within(details).getByRole('button', { name: 'Close details' }));
    expect(screen.queryByRole('region', { name: 'Historical selected record details' })).toBeNull();
  });

  test('is hidden, and nothing historical is requested, without historical.view', async () => {
    const calls = fakeBackend();
    open(['candidates.view']);
    await screen.findByRole('table', { name: 'Employees' });
    expect(screen.queryByText('Joining Verification Pending')).toBeNull();
    expect(calls.some((c) => c.path.startsWith('/historical-interviews'))).toBe(false);
  });

  test('is not on the phase pages, which list only verified employees', async () => {
    const calls = fakeBackend();
    open(undefined, '/employees/phase/evaluation');
    await screen.findByRole('table', { name: 'Evaluation' });
    expect(screen.queryByText('Joining Verification Pending')).toBeNull();
    expect(calls.some((c) => c.path.startsWith('/historical-interviews'))).toBe(false);
  });

  test('says so when there are no Selected records, and when they cannot be loaded', async () => {
    fakeBackend({ total: 0, items: [] });
    open();
    expect(await screen.findByText('No selected records yet')).toBeTruthy();
    cleanup();
    vi.unstubAllGlobals();

    fakeBackend({ listStatus: 500 });
    open();
    expect(await screen.findByText('The selected records could not be loaded')).toBeTruthy();
    // The verified employees still load.
    expect(screen.getByRole('table', { name: 'Employees' })).toBeTruthy();
  });
});

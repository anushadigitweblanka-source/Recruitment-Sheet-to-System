// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.jsx';
import { AuthContext } from '../src/auth/AuthContext.jsx';

// The Offered Salary (LKR) column of the Offer List. Every name and amount is
// made up; the backend is a pretend one that records what the page asks for.

const as = (permissions) => ({
  status: 'authenticated',
  user: {
    id: 1,
    email: 'test.user@example.test',
    fullName: 'Test User',
    role: { code: 'main_user', name: 'Main User' },
    permissions,
  },
  login: async () => ({ ok: true }),
  logout: async () => ({ ok: true }),
});

const candidate = (id) => ({
  id,
  candidateCode: `TEST-${id}`,
  fullName: `Sample Person ${id}`,
  position: 'Sample Position',
  positionId: 1,
  stage: { code: 'offer_sent', name: 'Offer Sent' },
});
const offer = (id) => ({
  id,
  positionId: 1,
  position: 'Sample Position',
  offerDate: '2026-10-05',
  workMode: null,
  location: null,
  offerStatus: 'sent',
  onboardingDate: null,
  attended: null,
});

const LIST = {
  items: [
    { candidate: candidate(11), offer: offer(101) },
    { candidate: candidate(12), offer: offer(102) },
    { candidate: candidate(13), offer: null },
  ],
  total: 3,
  page: 1,
  pageSize: 20,
};

function fakeBackend({ salaries = { 11: 150000, 12: null }, listStatus = 200 } = {}) {
  const amounts = { ...salaries };
  const calls = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (address, options = {}) => {
      const url = new URL(address, 'http://test.local');
      const method = options.method ?? 'GET';
      const body = options.body ? JSON.parse(options.body) : null;
      const path = url.pathname.replace('/api', '');
      calls.push({ method, path, query: Object.fromEntries(url.searchParams), body });

      if (path === '/offers') return json(LIST, listStatus);
      if (path === '/salary' && method === 'GET') {
        const ids = url.searchParams.get('candidateIds').split(',').map(Number);
        return json({
          items: ids.map((id) => ({ candidateId: id, salaryLkr: amounts[id] ?? null })),
        });
      }
      const single = /^\/salary\/(\d+)$/.exec(path);
      if (single && method === 'PUT') {
        const id = Number(single[1]);
        if (Number(body.salaryLkr) < 0) {
          return json({ fields: { salaryLkr: 'Salary must be a number from 0.' } }, 422);
        }
        amounts[id] = Number(body.salaryLkr);
        return json({ salary: { candidateId: id, salaryLkr: amounts[id] } });
      }
      return json({ error: 'not_found' }, 404);
    }),
  );
  return { calls, amounts };
}

const renderOffers = (permissions) =>
  render(
    <AuthContext.Provider value={as(permissions)}>
      <MemoryRouter initialEntries={['/offers']}>
        <App />
      </MemoryRouter>
    </AuthContext.Provider>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const headings = (table) =>
  within(table)
    .getAllByRole('columnheader')
    .map((th) => th.textContent);

describe('Offer List salary column', () => {
  test('without salary.view there is no column, no value, no action and no request', async () => {
    const backend = fakeBackend();
    renderOffers(['candidates.view', 'offers.manage']);
    const table = await screen.findByRole('table', { name: 'Offers' });

    expect(headings(table)).not.toContain('Offered Salary (LKR)');
    expect(screen.queryByText('Not Set')).toBeNull();
    expect(screen.queryByText(/Add Salary|Edit Salary/)).toBeNull();
    expect(screen.queryByText(/150,000/)).toBeNull();
    expect(backend.calls.some((c) => c.path.startsWith('/salary'))).toBe(false);
  });

  test('with salary.view the column sits before Email Status and shows LKR or Not Set', async () => {
    const backend = fakeBackend();
    renderOffers(['candidates.view', 'offers.manage', 'salary.view']);
    const table = await screen.findByRole('table', { name: 'Offers' });

    const names = headings(table);
    expect(names.indexOf('Offered Salary (LKR)')).toBe(names.indexOf('Email Status') - 1);

    await within(table).findByText(/150,000\.00/);
    expect(within(table).getByText(/^LKR.150,000[.]00$/)).toBeTruthy();
    expect(within(table).getByText('Not Set')).toBeTruthy();
    // A candidate with no offer yet has no salary cell content.
    expect(within(table).getAllByText('--').length).toBeGreaterThan(0);

    // Only the salary route is asked, once, for the offers on the page.
    const asked = backend.calls.filter((c) => c.path === '/salary');
    expect(asked).toHaveLength(1);
    expect(asked[0].query.candidateIds).toBe('11,12');
  });

  test('read-only salary.view shows no Add/Edit Salary action', async () => {
    fakeBackend();
    renderOffers(['candidates.view', 'offers.manage', 'salary.view']);
    const table = await screen.findByRole('table', { name: 'Offers' });
    await within(table).findByText(/150,000\.00/);
    expect(screen.queryByText(/Add Salary|Edit Salary/)).toBeNull();
  });

  test('salary.edit adds a salary inline and shows it formatted', async () => {
    const backend = fakeBackend();
    renderOffers(['candidates.view', 'offers.manage', 'salary.view', 'salary.edit']);
    const table = await screen.findByRole('table', { name: 'Offers' });
    await within(table).findByText(/150,000\.00/);

    expect(screen.getByRole('button', { name: 'Edit salary of Sample Person 11' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add salary of Sample Person 12' }));

    fireEvent.change(screen.getByLabelText('Salary (LKR) for Sample Person 12'), {
      target: { value: '210000.5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await within(table).findByText(/210,000\.50/);
    expect(backend.calls.find((c) => c.method === 'PUT' && c.path === '/salary/12').body).toEqual({
      salaryLkr: '210000.5',
    });
    expect(screen.getByRole('button', { name: 'Edit salary of Sample Person 12' })).toBeTruthy();
  });

  test('an invalid amount is explained and nothing changes', async () => {
    fakeBackend();
    renderOffers(['candidates.view', 'offers.manage', 'salary.view', 'salary.edit']);
    const table = await screen.findByRole('table', { name: 'Offers' });
    await within(table).findByText(/150,000\.00/);

    fireEvent.click(screen.getByRole('button', { name: 'Edit salary of Sample Person 11' }));
    fireEvent.change(screen.getByLabelText('Salary (LKR) for Sample Person 11'), {
      target: { value: '-5' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Salary must be a number from 0.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await within(table).findByText(/150,000\.00/)).toBeTruthy();
  });

  test('the existing columns and filters are unchanged', async () => {
    const backend = fakeBackend();
    renderOffers(['candidates.view', 'offers.manage', 'salary.view']);
    const table = await screen.findByRole('table', { name: 'Offers' });

    for (const label of [
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
    ]) {
      expect(headings(table)).toContain(label);
    }
    fireEvent.change(screen.getByLabelText('Offer Status'), { target: { value: 'sent' } });
    await waitFor(() =>
      expect(
        backend.calls.some((c) => c.path === '/offers' && c.query.offerStatus === 'sent'),
      ).toBe(true),
    );
  });
});

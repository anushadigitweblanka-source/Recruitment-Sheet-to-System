// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.jsx';
import { AuthContext } from '../src/auth/AuthContext.jsx';

// The Salary and Offer report tab. Every name and amount is made up.

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

const REPORT = {
  total: 2,
  page: 1,
  pageSize: 20,
  groups: [
    {
      position: 'Sample Position',
      offerStatus: 'accepted',
      offers: 2,
      priced: 1,
      lowest: 111111.11,
      average: 111111.11,
      highest: 111111.11,
      total: 111111.11,
    },
  ],
  items: [
    {
      id: 1,
      candidateCode: 'TEST-901',
      fullName: 'Sample Person One',
      position: 'Sample Position',
      source: null,
      offerStatus: 'accepted',
      offerDate: '2026-10-05',
      salaryLkr: 111111.11,
    },
    {
      id: 2,
      candidateCode: 'TEST-902',
      fullName: 'Sample Person Two',
      position: 'Sample Position',
      source: null,
      offerStatus: 'accepted',
      offerDate: null,
      salaryLkr: null,
    },
  ],
};

function mockBackend({ salaryStatus = 200 } = {}) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (address) => {
      const url = new URL(address, 'http://test.local');
      const path = url.pathname.replace('/api', '');
      calls.push({ path, query: Object.fromEntries(url.searchParams) });
      const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

      if (path.startsWith('/lookups/')) {
        if (path.endsWith('stages')) return json({ items: [{ code: 'applied', name: 'Applied' }] });
        return json({ items: [{ id: 1, name: 'Sample Position' }] });
      }
      if (path === '/reports/salary-offers') {
        return salaryStatus === 200 ? json(REPORT) : json({ error: 'forbidden' }, salaryStatus);
      }
      if (path === '/reports/salary-offers/export') {
        return new Response('fictional file', {
          status: 200,
          headers: { 'content-disposition': 'attachment; filename="salary-offers-2026-10-15.csv"' },
        });
      }
      if (path === '/reports/candidate-status') {
        return json({ items: [], total: 0, page: 1, pageSize: 20 });
      }
      return json({ items: [], stages: [] });
    }),
  );
  return calls;
}

const renderReports = (permissions) =>
  render(
    <AuthContext.Provider value={as(permissions)}>
      <MemoryRouter initialEntries={['/reports']}>
        <App />
      </MemoryRouter>
    </AuthContext.Provider>,
  );

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Salary & Offers tab', () => {
  test('is not offered, and the salary API is never called, without salary.view', async () => {
    const calls = mockBackend();
    renderReports(['candidates.view']);
    await screen.findByRole('table', { name: 'Candidate status report' });

    expect(screen.queryByRole('tab', { name: 'Salary & Offers' })).toBeNull();
    expect(calls.some((c) => c.path.startsWith('/reports/salary-offers'))).toBe(false);
  });

  test('shows salary by position and offer status with the restricted notice', async () => {
    const calls = mockBackend();
    renderReports(['candidates.view', 'salary.view']);
    fireEvent.click(await screen.findByRole('tab', { name: 'Salary & Offers' }));

    const summary = await screen.findByRole('table', {
      name: 'Offered salary by position and offer status',
    });
    expect(within(summary).getByText('Sample Position')).toBeTruthy();
    expect(within(summary).getAllByText('111,111.11').length).toBeGreaterThan(0);

    const offers = screen.getByRole('table', { name: 'Offers' });
    expect(within(offers).getByText('Sample Person One (TEST-901)')).toBeTruthy();
    expect(within(offers).getByText('Not set')).toBeTruthy();
    expect(screen.getByText(/recorded in the audit log/)).toBeTruthy();
    expect(calls.some((c) => c.path === '/reports/salary-offers')).toBe(true);
  });

  test('a filter change asks the server again with that filter', async () => {
    const calls = mockBackend();
    renderReports(['candidates.view', 'salary.view']);
    fireEvent.click(await screen.findByRole('tab', { name: 'Salary & Offers' }));
    await screen.findByRole('table', { name: 'Offers' });

    fireEvent.change(screen.getByLabelText('Offer status'), { target: { value: 'sent' } });
    await waitFor(() =>
      expect(
        calls.some((c) => c.path === '/reports/salary-offers' && c.query.offerStatus === 'sent'),
      ).toBe(true),
    );
  });

  test('exports go to the Main User only route with the chosen filters', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:fictional');
    URL.revokeObjectURL = vi.fn();
    const calls = mockBackend();
    renderReports(['candidates.view', 'salary.view']);
    fireEvent.click(await screen.findByRole('tab', { name: 'Salary & Offers' }));
    await screen.findByRole('table', { name: 'Offers' });

    fireEvent.change(screen.getByLabelText('Offer status'), { target: { value: 'accepted' } });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    await waitFor(() =>
      expect(
        calls.some(
          (c) =>
            c.path === '/reports/salary-offers/export' &&
            c.query.format === 'csv' &&
            c.query.offerStatus === 'accepted',
        ),
      ).toBe(true),
    );
  });

  test('shows an error, not salary, when the server refuses', async () => {
    mockBackend({ salaryStatus: 403 });
    renderReports(['candidates.view', 'salary.view']);
    fireEvent.click(await screen.findByRole('tab', { name: 'Salary & Offers' }));
    expect(await screen.findByText('The report could not be loaded')).toBeTruthy();
    expect(screen.queryByText('111,111.11')).toBeNull();
  });
});

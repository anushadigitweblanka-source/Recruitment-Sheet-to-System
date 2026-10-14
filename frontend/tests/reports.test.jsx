// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.jsx';
import { AuthContext } from '../src/auth/AuthContext.jsx';

// Every name and figure in this file is made up.

const SIGNED_IN = {
  status: 'authenticated',
  user: {
    id: 1,
    email: 'test.user@example.test',
    fullName: 'Test User',
    role: { code: 'main_user', name: 'Main User' },
    permissions: ['candidates.view'],
  },
  login: async () => ({ ok: true }),
  logout: async () => ({ ok: true }),
};

const statusItems = [
  {
    id: 1,
    candidateCode: 'TEST-801',
    fullName: 'Sample Person One',
    position: 'Sample Position',
    source: 'Sample Source',
    stage: 'applied',
    stageName: 'Applied',
    stageChangedAt: '2026-10-01T04:30:00.000Z',
    createdAt: '2026-10-01T04:30:00.000Z',
  },
];

const weekly = {
  weekStart: '2026-10-05',
  weekEnd: '2026-10-11',
  applications: 4,
  offersSent: 2,
  offersAccepted: 1,
  joined: 1,
  rejected: 0,
  movements: [{ stage: 'offer_sent', stageName: 'Offer Sent', total: 2 }],
};

function mockReports({ statusFails = false, empty = false } = {}) {
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
      if (path === '/reports/candidate-status') {
        if (statusFails) return json({ error: 'boom' }, 500);
        const items = empty ? [] : statusItems;
        return json({ items, total: items.length, page: 1, pageSize: 20 });
      }
      if (path === '/reports/weekly') return json(weekly);
      if (path === '/reports/exit') return json({ items: [] });
      return json({ items: [], stages: [] });
    }),
  );
  return calls;
}

function renderReports() {
  return render(
    <AuthContext.Provider value={SIGNED_IN}>
      <MemoryRouter initialEntries={['/reports']}>
        <App />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('reports page', () => {
  test('shows the candidate status report by default', async () => {
    mockReports();
    renderReports();
    const table = await screen.findByRole('table', { name: 'Candidate status report' });
    expect(within(table).getByText('Sample Person One (TEST-801)')).toBeTruthy();
    expect(within(table).getByText('Applied')).toBeTruthy();
  });

  test('a filter change requests the report again with the filter', async () => {
    const calls = mockReports();
    renderReports();
    await screen.findByRole('table', { name: 'Candidate status report' });

    fireEvent.change(screen.getByLabelText('Stage'), { target: { value: 'applied' } });
    await waitFor(() => {
      const statusCalls = calls.filter((c) => c.path === '/reports/candidate-status');
      expect(statusCalls.at(-1).query.stage).toBe('applied');
    });
  });

  test('the weekly tab shows the week figures from the API', async () => {
    mockReports();
    renderReports();
    await screen.findByRole('table', { name: 'Candidate status report' });

    fireEvent.click(screen.getByRole('tab', { name: 'Weekly' }));
    await waitFor(() => expect(screen.getByText('Applications')).toBeTruthy());
    expect(screen.getByText('Applications').closest('.stat-card').textContent).toContain('4');
    expect(screen.getByText('Offers Sent').closest('.stat-card').textContent).toContain('2');
    const table = screen.getByRole('table', { name: 'Stage movements in the week' });
    expect(within(table).getByText('Offer Sent')).toBeTruthy();
  });

  test('an empty report shows its empty message, never fake rows', async () => {
    mockReports({ empty: true });
    renderReports();
    await screen.findByText('No candidates match');

    fireEvent.click(screen.getByRole('tab', { name: 'Exit' }));
    await screen.findByText('No exits');
  });

  test('a failing report shows the error state with retry', async () => {
    mockReports({ statusFails: true });
    renderReports();
    await screen.findByText('The report could not be loaded');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

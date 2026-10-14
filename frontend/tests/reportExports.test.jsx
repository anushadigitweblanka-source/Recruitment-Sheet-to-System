// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

function mockApi({ exportFails = false } = {}) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (address) => {
      const url = new URL(address, 'http://test.local');
      const path = url.pathname.replace('/api', '');
      calls.push({ path, query: Object.fromEntries(url.searchParams) });
      const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

      if (path.includes('/export')) {
        if (exportFails) return json({ error: 'boom' }, 500);
        return new Response(new Blob(['fictional file']), {
          status: 200,
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="candidate-status-2026-10-14.csv"',
          },
        });
      }
      if (path.startsWith('/lookups/')) {
        if (path.endsWith('stages')) return json({ items: [{ code: 'applied', name: 'Applied' }] });
        return json({ items: [{ id: 1, name: 'Sample Position' }] });
      }
      if (path === '/reports/candidate-status') {
        return json({ items: [], total: 0, page: 1, pageSize: 20 });
      }
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
  vi.restoreAllMocks();
});

const stubDownload = () => {
  // jsdom has no createObjectURL; define stubs without replacing the URL class.
  URL.createObjectURL = vi.fn(() => 'blob:fictional');
  URL.revokeObjectURL = vi.fn();
  return vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
};

describe('report exports', () => {
  test('all three export buttons are shown for the current report', async () => {
    mockApi();
    renderReports();
    await screen.findByText('No candidates match');
    expect(screen.getByRole('button', { name: 'Export Excel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeTruthy();
  });

  test('exporting uses the current report, format and filters, and downloads', async () => {
    const calls = mockApi();
    const click = stubDownload();
    renderReports();
    await screen.findByText('No candidates match');

    fireEvent.change(screen.getByLabelText('Stage'), { target: { value: 'applied' } });
    await waitFor(() => {
      const list = calls.filter((c) => c.path === '/reports/candidate-status');
      expect(list.at(-1).query.stage).toBe('applied');
    });

    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => {
      const exportCall = calls.find((c) => c.path === '/reports/candidate-status/export');
      expect(exportCall).toBeTruthy();
      expect(exportCall.query.format).toBe('csv');
      expect(exportCall.query.stage).toBe('applied');
    });
    await waitFor(() => expect(click).toHaveBeenCalled());
  });

  test('the export route follows the selected tab', async () => {
    const calls = mockApi();
    stubDownload();
    renderReports();
    await screen.findByText('No candidates match');

    fireEvent.click(screen.getByRole('tab', { name: 'Funnel' }));
    await screen.findByRole('table', { name: 'Funnel report' });
    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
    await waitFor(() => {
      const exportCall = calls.find((c) => c.path === '/reports/funnel/export');
      expect(exportCall?.query.format).toBe('xlsx');
    });
  });

  test('a failed export shows an error and recovers', async () => {
    mockApi({ exportFails: true });
    renderReports();
    await screen.findByText('No candidates match');

    fireEvent.click(screen.getByRole('button', { name: 'Export PDF' }));
    await screen.findByText('The export could not be prepared. Try again.');
    expect(screen.getByRole('button', { name: 'Export PDF' })).toBeTruthy();
  });

  test('buttons disable while an export is being prepared', async () => {
    mockApi();
    // An export that never resolves keeps the loading state visible.
    const originalFetch = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (address) => {
        if (String(address).includes('/export')) return new Promise(() => {});
        return originalFetch(address);
      }),
    );
    renderReports();
    await screen.findByText('No candidates match');

    fireEvent.click(screen.getByRole('button', { name: 'Export Excel' }));
    await screen.findByRole('button', { name: 'Preparing…' });
    expect(screen.getByRole('button', { name: 'Export CSV' }).disabled).toBe(true);
  });
});

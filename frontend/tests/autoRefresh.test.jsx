// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AuthContext } from '../src/auth/AuthContext.jsx';
import { useApi } from '../src/hooks/useApi.js';
import RecruitmentRecordsList from '../src/modules/historical/RecruitmentRecordsList.jsx';

// A list left open shows what was saved meanwhile when the tab comes back into
// view, without pressing F5. Every name and number here is made up.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ok = (body) => Promise.resolve({ ok: true, status: 200, body });
const failed = () => Promise.resolve({ ok: false, status: 500, body: null });

function Probe({ load, options }) {
  const result = useApi(load, [], options);
  return <p data-testid="out">{`${result.status}:${result.data ?? ''}`}</p>;
}

const comeBack = () => act(async () => void window.dispatchEvent(new Event('focus')));

describe('useApi refreshOnFocus', () => {
  test('fetches again when the window comes back into view and shows the new data', async () => {
    let value = 'one';
    render(<Probe load={() => ok(value)} options={{ refreshOnFocus: true }} />);
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('ready:one'));

    value = 'two';
    await comeBack();
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('ready:two'));
  });

  test('keeps the data on screen if the quiet refresh fails', async () => {
    let succeed = true;
    render(
      <Probe load={() => (succeed ? ok('one') : failed())} options={{ refreshOnFocus: true }} />,
    );
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('ready:one'));

    succeed = false;
    await comeBack();
    expect(screen.getByTestId('out').textContent).toBe('ready:one');
  });

  test('does not refetch on focus unless the page asks for it', async () => {
    const load = vi.fn(() => ok('one'));
    render(<Probe load={load} />);
    await waitFor(() => expect(screen.getByTestId('out').textContent).toBe('ready:one'));
    await comeBack();
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('Recruitment Records list', () => {
  const auth = {
    status: 'authenticated',
    user: {
      id: 1,
      email: 'test.user@example.test',
      fullName: 'Test User',
      role: { code: 'hr', name: 'HR' },
      permissions: ['candidates.view', 'candidates.edit', 'historical.view'],
    },
    login: async () => ({ ok: true }),
    logout: async () => ({ ok: true }),
  };
  const row = (kind, id, name, candidateId = null) => ({
    kind,
    id,
    candidateId,
    candidateName: name,
    contactNumber: '0710000000',
    position: 'Sample Position A',
    source: 'Fictional Board',
    date: '2026-10-20',
    mode: null,
    status: kind === 'candidate' ? 'Applied' : 'Selected',
    remarks: null,
    extraValue: null,
    recordNumber: kind === 'candidate' ? null : id,
    reviewFlags: [],
  });

  test('shows a candidate saved meanwhile after the tab regains focus, history still listed', async () => {
    let items = [row('historical', 5, 'Hist Sample Five')];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (address) => {
        const path = new URL(address, 'http://test.local').pathname.replace('/api', '');
        const json = (body) => new Response(JSON.stringify(body), { status: 200 });
        if (path === '/recruitment-records/options') return json({ positions: [], sources: [] });
        if (path === '/recruitment-records') {
          return json({ items, total: items.length, page: 1, pageSize: 25 });
        }
        return json({});
      }),
    );

    render(
      <MemoryRouter>
        <AuthContext.Provider value={auth}>
          <RecruitmentRecordsList />
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Hist Sample Five')).toBeTruthy();
    expect(screen.queryByText('Brand New Candidate')).toBeNull();

    items = [row('candidate', 77, 'Brand New Candidate', 'S-0077'), ...items];
    await comeBack();

    expect(await screen.findByText('Brand New Candidate')).toBeTruthy();
    expect(screen.getByText('Hist Sample Five')).toBeTruthy();
  });
});

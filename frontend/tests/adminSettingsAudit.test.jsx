// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.jsx';
import { AuthContext } from '../src/auth/AuthContext.jsx';

// Every name and value in this file is made up.

const SIGNED_IN = {
  status: 'authenticated',
  user: {
    id: 1,
    email: 'test.user@example.test',
    fullName: 'Test User',
    role: { code: 'main_user', name: 'Main User' },
    permissions: ['candidates.view', 'admin.manage'],
  },
  login: async () => ({ ok: true }),
  logout: async () => ({ ok: true }),
};

const settings = () => [
  {
    key: 'evaluation_days',
    value: '7',
    description: 'Length of the evaluation, in days.',
    updatedAt: '2026-10-13T06:00:00.000Z',
  },
  {
    key: 'probation_months',
    value: '3',
    description: 'Length of probation, in months.',
    updatedAt: '2026-10-13T06:00:00.000Z',
  },
];

const auditItems = () => [
  {
    id: 2,
    action: 'SETTING_UPDATE',
    entityType: 'settings',
    entityId: null,
    actor: { name: 'Test User', email: 'test.user@example.test' },
    oldValues: { value: '7' },
    newValues: { value: '9' },
    details: { key: 'evaluation_days' },
    occurredAt: '2026-10-14T05:00:00.000Z',
  },
  {
    id: 1,
    action: 'LOGIN_SUCCESS',
    entityType: 'users',
    entityId: 1,
    actor: null,
    oldValues: null,
    newValues: null,
    details: null,
    occurredAt: '2026-10-14T04:00:00.000Z',
  },
];

function mockApi({ saveFails = false, auditEmpty = false } = {}) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (address, options = {}) => {
      const url = new URL(address, 'http://test.local');
      const path = url.pathname.replace('/api', '');
      const method = options.method ?? 'GET';
      calls.push({ path, method, query: Object.fromEntries(url.searchParams) });
      const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

      if (path === '/admin/settings' && method === 'GET') return json({ items: settings() });
      if (path.startsWith('/admin/settings/') && method === 'PATCH') {
        if (saveFails) {
          return json(
            {
              error: 'validation_failed',
              fields: { value: 'The value must be a whole number from 1 to 365.' },
            },
            422,
          );
        }
        const key = path.split('/').at(-1);
        return json({ setting: { ...settings()[0], key, value: '9' } });
      }
      if (path === '/admin/audit-log') {
        const items = auditEmpty ? [] : auditItems();
        return json({ items, total: items.length, page: 1, pageSize: 25 });
      }
      return json({ items: [] });
    }),
  );
  return calls;
}

function renderAt(path) {
  return render(
    <AuthContext.Provider value={SIGNED_IN}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('settings page', () => {
  test('loads and shows the existing settings with values and descriptions', async () => {
    mockApi();
    renderAt('/admin/settings');
    await screen.findByLabelText('Evaluation length (days)');
    expect(screen.getByLabelText('Evaluation length (days)').value).toBe('7');
    expect(screen.getByText('Length of the evaluation, in days.')).toBeTruthy();
    expect(screen.getByLabelText('Probation length (months)').value).toBe('3');
  });

  test('editing and saving sends the PATCH and confirms', async () => {
    const calls = mockApi();
    renderAt('/admin/settings');
    const input = await screen.findByLabelText('Evaluation length (days)');

    fireEvent.change(input, { target: { value: '9' } });
    const row = input.closest('.panel');
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));

    await screen.findByText('Saved.');
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch.path).toBe('/admin/settings/evaluation_days');
  });

  test('a rejected value shows the validation message', async () => {
    mockApi({ saveFails: true });
    renderAt('/admin/settings');
    const input = await screen.findByLabelText('Evaluation length (days)');
    fireEvent.change(input, { target: { value: '0' } });
    fireEvent.click(within(input.closest('.panel')).getByRole('button', { name: 'Save' }));
    await screen.findByText('The value must be a whole number from 1 to 365.');
  });
});

describe('audit log page', () => {
  test('renders entries with actor, action and summary', async () => {
    mockApi();
    renderAt('/admin/audit-log');
    const table = await screen.findByRole('table', { name: 'Audit log' });
    expect(within(table).getByText('SETTING_UPDATE')).toBeTruthy();
    expect(within(table).getByText('Test User')).toBeTruthy();
    expect(within(table).getByText('System')).toBeTruthy();
    expect(within(table).getByText(/"value":"7"/)).toBeTruthy();
  });

  test('filters send their values to the API', async () => {
    const calls = mockApi();
    renderAt('/admin/audit-log');
    await screen.findByRole('table', { name: 'Audit log' });

    fireEvent.change(screen.getByLabelText('Action code'), { target: { value: 'login_success' } });
    await waitFor(() => {
      const last = calls.filter((c) => c.path === '/admin/audit-log').at(-1);
      expect(last.query.action).toBe('LOGIN_SUCCESS');
    });
  });

  test('an empty result shows the empty state', async () => {
    mockApi({ auditEmpty: true });
    renderAt('/admin/audit-log');
    await screen.findByText('No audit entries match');
  });
});

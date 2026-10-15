// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.jsx';
import { AuthContext } from '../src/auth/AuthContext.jsx';

// Read-only roles and permissions page. Every role and permission in this
// file mirrors the shapes the API returns; nothing here is a real account.

const SIGNED_IN = {
  status: 'authenticated',
  user: {
    id: 1,
    email: 'admin.test@example.test',
    fullName: 'Admin Test',
    role: { code: 'main_user', name: 'Main User' },
    permissions: ['candidates.view', 'admin.manage'],
  },
  login: async () => ({ ok: true }),
  logout: async () => ({ ok: true }),
};

const payload = () => ({
  items: [
    {
      id: 1,
      code: 'main_user',
      name: 'Main User',
      description: 'Sees and manages everything, including users.',
      userCount: 3,
      permissions: ['admin.manage', 'candidates.edit', 'candidates.view'],
    },
    {
      id: 2,
      code: 'test_viewer',
      name: 'Test Viewer',
      description: null,
      userCount: 1,
      permissions: ['candidates.view'],
    },
  ],
  permissions: [
    { id: 1, code: 'admin.manage', description: 'Manage users, roles and settings' },
    { id: 2, code: 'candidates.edit', description: 'Add and edit candidates' },
    { id: 3, code: 'candidates.view', description: 'View candidates' },
  ],
});

function mockApi({ empty = false, fails = false } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (address) => {
      const url = new URL(address, 'http://test.local');
      if (url.pathname.replace('/api', '') === '/admin/roles') {
        if (fails) return new Response('{"error":"boom"}', { status: 500 });
        const body = empty ? { items: [], permissions: [] } : payload();
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response('{"items":[]}', { status: 200 });
    }),
  );
}

function renderRoles() {
  return render(
    <AuthContext.Provider value={SIGNED_IN}>
      <MemoryRouter initialEntries={['/admin/roles']}>
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

describe('roles page', () => {
  test('shows the loading state first', async () => {
    mockApi();
    renderRoles();
    expect(screen.getByText('Loading roles…')).toBeTruthy();
    await screen.findByRole('table', { name: 'Roles' });
  });

  test('renders exactly the roles the API returned, with their permissions', async () => {
    mockApi();
    renderRoles();
    const table = await screen.findByRole('table', { name: 'Roles' });
    expect(within(table).getByText('Main User')).toBeTruthy();
    expect(within(table).getByText('main_user')).toBeTruthy();
    expect(within(table).getByText('Test Viewer')).toBeTruthy();
    expect(within(table).getByText('admin.manage, candidates.edit, candidates.view')).toBeTruthy();
    expect(within(table).getAllByRole('row')).toHaveLength(3); // header + 2 roles, none invented
  });

  test('shows the read-only notice', async () => {
    mockApi();
    renderRoles();
    await screen.findByText(
      /Role definitions are read-only until the final role and permission structure is approved/,
    );
  });

  test('renders the permission matrix with assigned and unassigned cells', async () => {
    mockApi();
    renderRoles();
    const matrix = await screen.findByRole('table', {
      name: 'Which role holds which permission',
    });
    expect(within(matrix).getByText('admin.manage')).toBeTruthy();
    expect(within(matrix).getByText('View candidates')).toBeTruthy();
    // main_user holds all three; test_viewer only candidates.view
    expect(within(matrix).getAllByText('Assigned')).toHaveLength(4);
    expect(within(matrix).getAllByLabelText('Not assigned')).toHaveLength(2);
    // nothing in the matrix is editable
    expect(within(matrix).queryAllByRole('button')).toHaveLength(0);
    expect(within(matrix).queryAllByRole('checkbox')).toHaveLength(0);
  });

  test('shows the empty state when no roles exist', async () => {
    mockApi({ empty: true });
    renderRoles();
    await screen.findByText('No roles');
  });

  test('shows the error state with a retry when the request fails', async () => {
    mockApi({ fails: true });
    renderRoles();
    await screen.findByText('Roles could not be loaded');
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
  });
});

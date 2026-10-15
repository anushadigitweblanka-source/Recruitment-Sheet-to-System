// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.jsx';
import { AuthContext } from '../src/auth/AuthContext.jsx';

// Every name and address in this file is made up.

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

const users = () => [
  {
    id: 1,
    fullName: 'Admin Test',
    email: 'admin.test@example.test',
    isActive: true,
    role: { id: 1, code: 'main_user', name: 'Main User' },
    lastLoginAt: '2026-10-14T06:00:00.000Z',
    createdAt: '2026-10-01T06:00:00.000Z',
  },
  {
    id: 2,
    fullName: 'Viewer Test',
    email: 'user.viewer.test@example.test',
    isActive: false,
    role: { id: 1, code: 'main_user', name: 'Main User' },
    lastLoginAt: null,
    createdAt: '2026-10-02T06:00:00.000Z',
  },
];

function mockApi({ createFails = false, empty = false } = {}) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (address, options = {}) => {
      const url = new URL(address, 'http://test.local');
      const path = url.pathname.replace('/api', '');
      const method = options.method ?? 'GET';
      const body = options.body ? JSON.parse(options.body) : null;
      calls.push({ path, method, body });
      const json = (payload, status = 200) => new Response(JSON.stringify(payload), { status });

      if (path === '/admin/users/roles') {
        return json({ items: [{ id: 1, code: 'main_user', name: 'Main User' }] });
      }
      if (path === '/admin/users' && method === 'GET') {
        return json({ items: empty ? [] : users() });
      }
      if (path === '/admin/users' && method === 'POST') {
        if (createFails) {
          return json(
            {
              error: 'validation_failed',
              fields: { password: 'The password must be at least 12 characters long.' },
            },
            422,
          );
        }
        return json(
          {
            user: {
              id: 3,
              fullName: body.fullName,
              email: body.email.toLowerCase(),
              isActive: true,
              role: { id: 1, code: 'main_user', name: 'Main User' },
              lastLoginAt: null,
              createdAt: '2026-10-14T06:00:00.000Z',
            },
          },
          201,
        );
      }
      if (/\/admin\/users\/\d+\/status$/.test(path)) {
        const id = Number(path.split('/')[3]);
        const user = users().find((u) => u.id === id);
        return json({ user: { ...user, isActive: body.isActive } });
      }
      if (/\/admin\/users\/\d+\/reset-password$/.test(path)) {
        return json({ reset: true });
      }
      return json({ items: [] });
    }),
  );
  return calls;
}

function renderUsers() {
  return render(
    <AuthContext.Provider value={SIGNED_IN}>
      <MemoryRouter initialEntries={['/admin/users']}>
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

describe('users page', () => {
  test('renders the user list with role and status', async () => {
    mockApi();
    renderUsers();
    const table = await screen.findByRole('table', { name: 'Users' });
    expect(within(table).getByText('Admin Test')).toBeTruthy();
    expect(within(table).getByText('user.viewer.test@example.test')).toBeTruthy();
    expect(within(table).getByText('Deactivated')).toBeTruthy();
  });

  test('shows the empty state when no users exist', async () => {
    mockApi({ empty: true });
    renderUsers();
    await screen.findByText('No users');
  });

  test('the role dropdown offers only the roles the API returned', async () => {
    mockApi();
    renderUsers();
    const select = await screen.findByLabelText('Role');
    const options = within(select).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual(['Main User']);
  });

  test('creating a user sends the form and clears the password field', async () => {
    const calls = mockApi();
    renderUsers();
    await screen.findByRole('table', { name: 'Users' });

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Person' } });
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'new.person@example.test' },
    });
    const passwordInput = screen.getByLabelText('Password (at least 12 characters)');
    expect(passwordInput.type).toBe('password');
    fireEvent.change(passwordInput, { target: { value: 'fictional-password-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));

    await screen.findByText('The user was created. The password is not shown again.');
    const post = calls.find((c) => c.method === 'POST' && c.path === '/admin/users');
    expect(post.body.fullName).toBe('New Person');
    expect(passwordInput.value).toBe('', 'password cleared after save');
  });

  test('a validation error from the server is shown on the field', async () => {
    mockApi({ createFails: true });
    renderUsers();
    await screen.findByRole('table', { name: 'Users' });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X Person' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'x@example.test' } });
    fireEvent.change(screen.getByLabelText('Password (at least 12 characters)'), {
      target: { value: 'short' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create User' }));
    await screen.findByText('The password must be at least 12 characters long.');
  });

  test('deactivate asks for confirmation and updates the row', async () => {
    const calls = mockApi();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    renderUsers();
    const table = await screen.findByRole('table', { name: 'Users' });

    fireEvent.click(within(table).getAllByRole('button', { name: 'Deactivate' })[0]);
    await waitFor(() => {
      const patch = calls.find((c) => c.method === 'PATCH');
      expect(patch.body).toEqual({ isActive: false });
    });
    expect(window.confirm).toHaveBeenCalled();
    await screen.findByText('Admin Test is now deactivated.');
  });

  test('reset password requires matching entries and clears them after success', async () => {
    const calls = mockApi();
    renderUsers();
    const table = await screen.findByRole('table', { name: 'Users' });

    fireEvent.click(within(table).getAllByRole('button', { name: 'Reset password' })[0]);
    const form = await screen.findByRole('form', { name: /Reset password for/ });
    const pw = within(form).getByLabelText('New password (at least 12 characters)');
    const confirm = within(form).getByLabelText('Confirm new password');
    expect(pw.type).toBe('password');

    fireEvent.change(pw, { target: { value: 'fictional-password-123' } });
    fireEvent.change(confirm, { target: { value: 'different-password-999' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Reset password' }));
    await screen.findByText('The two passwords do not match.');
    expect(calls.some((c) => c.path.endsWith('/reset-password'))).toBe(false);

    fireEvent.change(confirm, { target: { value: 'fictional-password-123' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Reset password' }));
    await screen.findByText('The password was reset. It is not shown again.');
    expect(calls.some((c) => c.path.endsWith('/reset-password'))).toBe(true);
  });
});

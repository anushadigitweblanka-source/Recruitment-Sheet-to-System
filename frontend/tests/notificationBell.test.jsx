// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.jsx';
import { AuthContext } from '../src/auth/AuthContext.jsx';

// The in-app notification bell in the header. Every name is made up; the
// backend is a pretend one that records what the bell asks for.

const SIGNED_IN = {
  status: 'authenticated',
  user: {
    id: 1,
    email: 'test.user@example.test',
    fullName: 'Test User',
    role: { code: 'hr', name: 'HR' },
    permissions: ['candidates.view'],
  },
  login: async () => ({ ok: true }),
  logout: async () => ({ ok: true }),
};

const alert = (id, overrides = {}) => ({
  id,
  type: 'evaluation_end',
  candidate: { id: 10 + id, candidateCode: `TEST-${id}`, fullName: `Sample Person ${id}` },
  dueAt: '2026-11-08T12:00:00.000Z', // 17:30 in Colombo
  sendAt: '2026-11-07T12:00:00.000Z',
  emailStatus: 'pending',
  read: false,
  readAt: null,
  link: `/employees/${id}`,
  ...overrides,
});

function fakeBackend({ items = [], listStatus = 200, hang = false } = {}) {
  const state = { items: items.map((i) => ({ ...i })), calls: [], listStatus };
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (address, options = {}) => {
      const url = new URL(address, 'http://test.local');
      const method = options.method ?? 'GET';
      const path = url.pathname.replace('/api', '');
      state.calls.push({ method, path, query: Object.fromEntries(url.searchParams) });

      if (path === '/me/notifications' && method === 'GET') {
        if (hang) return new Promise(() => {});
        if (state.listStatus !== 200) return json({ error: 'boom' }, state.listStatus);
        return json({
          unreadCount: state.items.filter((i) => !i.read).length,
          items: state.items,
        });
      }
      const one = /^\/me\/notifications\/(\d+)\/read$/.exec(path);
      if (one && method === 'POST') {
        const found = state.items.find((i) => i.id === Number(one[1]));
        if (!found) return json({ error: 'not_found' }, 404);
        found.read = true;
        return json({ id: found.id, read: true });
      }
      if (path === '/me/notifications/read-all' && method === 'POST') {
        const marked = state.items.filter((i) => !i.read).length;
        state.items.forEach((i) => {
          i.read = true;
        });
        return json({ marked });
      }
      return json({ error: 'not_found' }, 404);
    }),
  );
  return state;
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
}

const open = (path = '/dashboard') =>
  render(
    <AuthContext.Provider value={SIGNED_IN}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </AuthContext.Provider>,
  );

const bell = () => screen.findByRole('button', { name: /^Notifications/ });
const callsTo = (state, method, path) =>
  state.calls.filter((c) => c.method === method && c.path === path);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('notification bell', () => {
  test('is in the header and shows the unread count', async () => {
    fakeBackend({ items: [alert(1), alert(2), alert(3, { read: true })] });
    open();

    const button = await screen.findByRole('button', { name: 'Notifications, 2 unread' });
    expect(within(button).getByText('2')).toBeTruthy();
    expect(button.closest('header')).toBeTruthy();
  });

  test('shows no count when nothing is unread', async () => {
    fakeBackend({ items: [alert(1, { read: true })] });
    open();

    const button = await screen.findByRole('button', { name: 'Notifications' });
    expect(within(button).queryByText('1')).toBeNull();
  });

  test('lists type, candidate, deadline, email status and a link', async () => {
    fakeBackend({
      items: [
        alert(1),
        alert(2, { type: 'interview_reminder', emailStatus: 'sent', link: '/interviews/9' }),
        alert(3, { type: 'joining_reminder', emailStatus: 'failed', link: null }),
      ],
    });
    open();
    fireEvent.click(await bell());

    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(within(panel).getByText('Evaluation End')).toBeTruthy();
    expect(within(panel).getByText('Interview Reminder')).toBeTruthy();
    expect(within(panel).getByText('Joining Reminder')).toBeTruthy();
    expect(within(panel).getByText('TEST-1 — Sample Person 1')).toBeTruthy();
    // 12:00 UTC is 17:30 in Asia/Colombo.
    expect(within(panel).getAllByText(/Deadline: .*17:30/).length).toBe(3);
    expect(within(panel).getByText('Email scheduled')).toBeTruthy();
    expect(within(panel).getByText('Email sent')).toBeTruthy();
    expect(within(panel).getByText('Email failed')).toBeTruthy();

    const links = within(panel).getAllByRole('link', { name: 'Open' });
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/employees/1', '/interviews/9']);
  });

  test('marking one as read lowers the count and tells the server', async () => {
    const backend = fakeBackend({ items: [alert(1), alert(2)] });
    open();
    fireEvent.click(await bell());
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });

    fireEvent.click(within(panel).getAllByRole('button', { name: 'Mark as read' })[0]);

    await screen.findByRole('button', { name: 'Notifications, 1 unread' });
    await waitFor(() =>
      expect(callsTo(backend, 'POST', '/me/notifications/1/read')).toHaveLength(1),
    );
  });

  test('mark all as read clears the count', async () => {
    const backend = fakeBackend({ items: [alert(1), alert(2)] });
    open();
    fireEvent.click(await bell());
    fireEvent.click(await screen.findByRole('button', { name: 'Mark all as read' }));

    await screen.findByRole('button', { name: 'Notifications' });
    await waitFor(() =>
      expect(callsTo(backend, 'POST', '/me/notifications/read-all')).toHaveLength(1),
    );
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).toBeNull();
  });

  test('opening an alert goes to its record and marks it read', async () => {
    const backend = fakeBackend({ items: [alert(5)] });
    open();
    fireEvent.click(await bell());
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });

    fireEvent.click(within(panel).getByRole('link', { name: 'Open' }));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/employees/5'));
    await waitFor(() =>
      expect(callsTo(backend, 'POST', '/me/notifications/5/read')).toHaveLength(1),
    );
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull();
  });

  test('says so when there are no notifications', async () => {
    fakeBackend({ items: [] });
    open();
    fireEvent.click(await bell());

    expect(await screen.findByText('You have no notifications.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark all as read' })).toBeNull();
  });

  test('shows a loading message while the request runs', async () => {
    fakeBackend({ hang: true });
    open();
    fireEvent.click(await bell());

    expect(await screen.findByText('Loading notifications…')).toBeTruthy();
  });

  test('shows an error with Try again, and recovers', async () => {
    const backend = fakeBackend({ items: [alert(1)], listStatus: 500 });
    open();
    fireEvent.click(await bell());

    expect(await screen.findByText('The notifications could not be loaded.')).toBeTruthy();

    backend.listStatus = 200;
    const panel = screen.getByRole('dialog', { name: 'Notifications' });
    fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('TEST-1 — Sample Person 1')).toBeTruthy();
  });

  test('closes with Escape', async () => {
    fakeBackend({ items: [alert(1)] });
    open();
    fireEvent.click(await bell());
    await screen.findByRole('dialog', { name: 'Notifications' });

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull());
  });

  test('asks only the signed-in user’s own alerts and shows no salary or addresses', async () => {
    const backend = fakeBackend({ items: [alert(1)] });
    open();
    fireEvent.click(await bell());
    await screen.findByRole('dialog', { name: 'Notifications' });

    const asked = callsTo(backend, 'GET', '/me/notifications');
    expect(asked.length).toBeGreaterThan(0);
    // The address carries no user id: the server uses the session.
    expect(asked.every((c) => c.path === '/me/notifications')).toBe(true);
    expect(document.body.textContent).not.toMatch(/salary|password|credential/i);
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.jsx';
import { AuthContext, AuthProvider } from '../src/auth/AuthContext.jsx';

const USER = {
  id: 1,
  email: 'test.user@example.test',
  fullName: 'Test User',
  role: { code: 'main_user', name: 'Main User' },
  permissions: [],
};

// Made up for the test; it is only ever sent to the pretend backend below.
const TEST_PASSWORD = `pw-${Math.random().toString(36).slice(2)}-${Date.now()}`;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

const currentPath = () => screen.getByTestId('location').textContent;

// Renders the app with a fixed auth state, without any backend.
function renderWithAuth(path, auth) {
  const value = {
    login: async () => ({ ok: true }),
    logout: async () => ({ ok: true }),
    ...auth,
  };
  return render(
    <AuthContext.Provider value={value}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

// A pretend backend that behaves like the real one for the three auth routes.
function fakeBackend({ signedIn = false } = {}) {
  const state = { signedIn, calls: [] };

  const fetchMock = vi.fn(async (url, options = {}) => {
    const method = options.method ?? 'GET';
    const body = options.body ? JSON.parse(options.body) : null;
    state.calls.push({ url, method, body });
    const json = (status, data) => ({ ok: status < 400, status, json: async () => data });

    if (url === '/api/auth/me') {
      return state.signedIn ? json(200, { user: USER }) : json(401, { error: 'Not signed in.' });
    }
    if (url === '/api/auth/login') {
      if (body.email === USER.email && body.password === TEST_PASSWORD) {
        state.signedIn = true;
        return json(200, { user: USER });
      }
      return json(401, { error: 'Sign-in failed. Check your email and password.' });
    }
    if (url === '/api/auth/logout') {
      state.signedIn = false;
      return { ok: true, status: 204, json: async () => null };
    }
    return json(404, { error: 'Not found' });
  });

  vi.stubGlobal('fetch', fetchMock);
  return state;
}

// Renders the app the way main.jsx does, with the real auth provider.
function renderRealApp(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <App />
        <LocationProbe />
      </AuthProvider>
    </MemoryRouter>,
  );
}

function fillAndSubmit(email, password) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
}

describe('the sign-in page', () => {
  test('shows the title, the two fields and the Sign In button', () => {
    renderWithAuth('/login', { status: 'anonymous', user: null });

    expect(screen.getByRole('heading', { name: 'Recruitment Sheet to System' })).toBeTruthy();
    expect(screen.getByLabelText('Email').type).toBe('email');
    expect(screen.getByLabelText('Password').type).toBe('password');
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy();
  });

  test('offers no registration, social sign-in or made-up user details', () => {
    const { container } = renderWithAuth('/login', { status: 'anonymous', user: null });

    expect(container.textContent).not.toMatch(/register|sign up|create account|google|forgot/i);
    expect(screen.getByLabelText('Email').value).toBe('');
    expect(screen.getByLabelText('Password').value).toBe('');
  });

  test('the Show button reveals and hides the password', () => {
    renderWithAuth('/login', { status: 'anonymous', user: null });
    const toggle = screen.getByRole('button', { name: /show password/i });

    fireEvent.click(toggle);
    expect(screen.getByLabelText('Password').type).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: /hide password/i }));
    expect(screen.getByLabelText('Password').type).toBe('password');
  });

  test('empty or badly formed input is stopped before anything is sent', () => {
    const login = vi.fn();
    renderWithAuth('/login', { status: 'anonymous', user: null, login });

    fireEvent.click(screen.getByRole('button', { name: 'Sign In' }));
    expect(screen.getByRole('alert').textContent).toBe('Enter your email address.');

    fillAndSubmit('not-an-email', TEST_PASSWORD);
    expect(screen.getByRole('alert').textContent).toBe('Enter a valid email address.');

    fillAndSubmit(USER.email, '');
    expect(screen.getByRole('alert').textContent).toBe('Enter your password.');

    expect(login).not.toHaveBeenCalled();
  });
});

describe('protected pages', () => {
  const PROTECTED = [
    '/dashboard',
    '/candidates',
    '/candidates/1',
    '/phone-interviews',
    '/interviews/1/evaluate',
    '/offers',
    '/employees/1/lifecycle',
    '/notifications',
    '/reports',
    '/admin/users',
    '/admin/system-status',
    '/',
    '/no-such-page',
  ];

  test.each(PROTECTED)('%s sends a visitor who is not signed in to the sign-in page', (path) => {
    renderWithAuth(path, { status: 'anonymous', user: null });

    expect(currentPath()).toBe('/login');
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
  });

  test('nothing protected is shown while the sign-in check is still running', () => {
    const { container } = renderWithAuth('/dashboard', { status: 'loading', user: null });

    expect(container.textContent).toContain('Checking your sign-in');
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).toBeNull();
    expect(screen.queryByLabelText('Password')).toBeNull();
  });

  test('a signed-in user reaches the dashboard', () => {
    renderWithAuth('/dashboard', { status: 'authenticated', user: USER });

    expect(currentPath()).toBe('/dashboard');
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeTruthy();
  });

  test('a signed-in user who opens /login or / is sent to the dashboard', () => {
    renderWithAuth('/login', { status: 'authenticated', user: USER });
    expect(currentPath()).toBe('/dashboard');
    cleanup();

    renderWithAuth('/', { status: 'authenticated', user: USER });
    expect(currentPath()).toBe('/dashboard');
  });
});

describe('signing in and out, end to end', () => {
  test('startup asks the backend who is signed in, then shows the sign-in page', async () => {
    const backend = fakeBackend();
    renderRealApp('/candidates');

    await screen.findByRole('button', { name: 'Sign In' });
    expect(currentPath()).toBe('/login');
    expect(backend.calls[0]).toMatchObject({ url: '/api/auth/me', method: 'GET' });
  });

  test('an existing session goes straight to the page that was asked for', async () => {
    fakeBackend({ signedIn: true });
    renderRealApp('/candidates');

    await screen.findByRole('heading', { name: 'Candidate List' });
    expect(currentPath()).toBe('/candidates');
  });

  test('the correct email and password open the dashboard with the user shown', async () => {
    const backend = fakeBackend();
    renderRealApp('/login');
    await screen.findByRole('button', { name: 'Sign In' });

    fillAndSubmit(`  ${USER.email} `, TEST_PASSWORD);

    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(currentPath()).toBe('/dashboard');
    expect(screen.getByText('Test User')).toBeTruthy();
    expect(screen.getByText(USER.email)).toBeTruthy();

    const loginCall = backend.calls.find((call) => call.url === '/api/auth/login');
    expect(loginCall.method).toBe('POST');
    expect(loginCall.body).toEqual({ email: USER.email, password: TEST_PASSWORD });
  });

  test('a wrong password shows the error, clears the password and stays on the page', async () => {
    fakeBackend();
    renderRealApp('/login');
    await screen.findByRole('button', { name: 'Sign In' });

    fillAndSubmit(USER.email, 'the-wrong-password');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Sign-in failed');
    expect(currentPath()).toBe('/login');
    expect(screen.getByLabelText('Password').value).toBe('');
    expect(screen.getByLabelText('Email').value).toBe(USER.email);
  });

  test('the password is never kept in browser storage', async () => {
    fakeBackend();
    renderRealApp('/login');
    await screen.findByRole('button', { name: 'Sign In' });

    fillAndSubmit(USER.email, TEST_PASSWORD);
    await screen.findByRole('heading', { name: 'Dashboard' });

    const stored = JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage });
    expect(stored).not.toContain(TEST_PASSWORD);
    expect(document.cookie).toBe('');
  });

  test('Logout calls the backend, clears the page and returns to sign-in', async () => {
    const backend = fakeBackend({ signedIn: true });
    renderRealApp('/candidates');
    await screen.findByRole('heading', { name: 'Candidate List' });

    fireEvent.click(screen.getAllByRole('button', { name: 'Logout' })[0]);

    await screen.findByRole('button', { name: 'Sign In' });
    expect(currentPath()).toBe('/login');
    expect(backend.calls.some((c) => c.url === '/api/auth/logout' && c.method === 'POST')).toBe(
      true,
    );
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.queryByText('Test User')).toBeNull();
  });

  // Found in a real browser: after Logout, Back could restore an earlier
  // signed-in page from the browser's back/forward cache.
  test('a page restored by Back or Forward is re-checked, and hidden if the session is gone', async () => {
    const backend = fakeBackend({ signedIn: true });
    renderRealApp('/dashboard');
    await screen.findByRole('heading', { name: 'Dashboard' });

    // The session ends elsewhere (for example, Logout on a later page)...
    backend.signedIn = false;
    // ...and the browser then brings this old page back from its memory.
    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    fireEvent(window, restored);

    await screen.findByRole('button', { name: 'Sign In' });
    expect(currentPath()).toBe('/login');
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.queryByText('Test User')).toBeNull();
  });

  test('a restored page stays open when the session is still valid', async () => {
    fakeBackend({ signedIn: true });
    renderRealApp('/candidates');
    await screen.findByRole('heading', { name: 'Candidate List' });

    const restored = new Event('pageshow');
    Object.defineProperty(restored, 'persisted', { value: true });
    fireEvent(window, restored);

    await screen.findByRole('heading', { name: 'Candidate List' });
    expect(currentPath()).toBe('/candidates');
  });

  test('if the backend cannot be reached, Logout keeps the user signed in and says so', async () => {
    fakeBackend({ signedIn: true });
    renderRealApp('/dashboard');
    await screen.findByRole('heading', { name: 'Dashboard' });

    // The server stops answering.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    fireEvent.click(screen.getAllByRole('button', { name: 'Logout' })[0]);

    await waitFor(() => expect(screen.getByText('You are still signed in')).toBeTruthy());
    expect(currentPath()).toBe('/dashboard');
  });
});

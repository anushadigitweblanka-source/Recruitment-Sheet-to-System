// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AuthContext } from '../src/auth/AuthContext.jsx';
import CandidateMessagePanel from '../src/modules/notifications/CandidateMessagePanel.jsx';

// The WhatsApp / SMS text panel: preview, then copy. Every name and number is
// made up; the backend is a pretend one that records what the screen sends.

const as = (permissions) => ({
  status: 'authenticated',
  user: {
    id: 1,
    email: 'test.user@example.test',
    fullName: 'Test User',
    role: { code: 'hr', name: 'HR' },
    permissions,
  },
  login: async () => ({ ok: true }),
  logout: async () => ({ ok: true }),
});

const json = (status, data) => ({ ok: status < 400, status, json: async () => data });

function fakeBackend(routes) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (address, options = {}) => {
      const url = new URL(address, 'http://test.local');
      const method = options.method ?? 'GET';
      const body = options.body ? JSON.parse(options.body) : null;
      const path = url.pathname.replace('/api', '');
      calls.push({ method, path, body });
      const handler = routes[`${method} ${path}`];
      if (!handler) return json(404, { error: 'not_found' });
      const result = typeof handler === 'function' ? handler(body) : handler;
      return result?.status ? result : json(200, result);
    }),
  );
  return { calls };
}

const show = (permissions) =>
  render(
    <AuthContext.Provider value={as(permissions)}>
      <MemoryRouter>
        <CandidateMessagePanel candidateId={3} />
      </MemoryRouter>
    </AuthContext.Provider>,
  );

const READY = {
  type: 'interview_invitation',
  channel: 'whatsapp_sms',
  to: '0760000123',
  text: 'Hello Sample Person, you are invited to a direct interview on 04 Nov 2026 at 14:30.',
  missing: [],
  canCopy: true,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('WhatsApp / SMS text panel', () => {
  test('is hidden from people who may not send mail and asks the server for nothing', () => {
    const backend = fakeBackend({});
    show(['candidates.view']);
    expect(screen.queryByText('WhatsApp / SMS text')).toBeNull();
    expect(backend.calls).toEqual([]);
  });

  test('previews the text and copies exactly that text; nothing is sent', async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const backend = fakeBackend({ 'POST /candidates/3/messages/preview': READY });
    show(['notifications.manage']);

    expect(screen.getByRole('button', { name: 'Preview message' }).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Message type'), {
      target: { value: 'interview_invitation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview message' }));

    const text = await screen.findByLabelText('Message text');
    expect(text.value).toBe(READY.text);
    expect(text.readOnly).toBe(true);
    expect(screen.getByText('0760000123')).toBeTruthy();
    expect(backend.calls).toEqual([
      {
        method: 'POST',
        path: '/candidates/3/messages/preview',
        body: { type: 'interview_invitation' },
      },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Copy Message' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(READY.text));
    expect(await screen.findByText(/Message copied/)).toBeTruthy();
    // Previewing and copying are the only calls: no send endpoint exists.
    expect(backend.calls).toHaveLength(1);
  });

  test('explains what is missing and does not allow copying', async () => {
    fakeBackend({
      'POST /candidates/3/messages/preview': {
        ...READY,
        text: '',
        missing: ['candidate phone number', 'interview date and time'],
        canCopy: false,
      },
    });
    show(['notifications.manage']);
    fireEvent.change(screen.getByLabelText('Message type'), {
      target: { value: 'interview_invitation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview message' }));

    expect(
      await screen.findByText(/Missing: candidate phone number, interview date and time\./),
    ).toBeTruthy();
    expect(screen.queryByLabelText('Message text')).toBeNull();
    expect(screen.getByRole('button', { name: 'Copy Message' }).disabled).toBe(true);
  });

  test('tells HR to schedule an interview first when none is saved', async () => {
    fakeBackend({
      'POST /candidates/3/messages/preview': {
        ...READY,
        text: '',
        missing: ['interview date and time'],
        canCopy: false,
        hint: 'No interview has been scheduled for this candidate yet. Record the phone interview as Selected first.',
      },
    });
    show(['notifications.manage']);
    fireEvent.change(screen.getByLabelText('Message type'), {
      target: { value: 'interview_invitation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview message' }));

    expect(
      await screen.findByText(/No interview has been scheduled for this candidate yet/),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy Message' }).disabled).toBe(true);
  });

  test('shows the server’s reason when the preview is refused', async () => {
    fakeBackend({
      'POST /candidates/3/messages/preview': json(422, {
        fields: { type: 'Message type must be one of: interview_invitation, joining_onboarding.' },
      }),
    });
    show(['notifications.manage']);
    fireEvent.change(screen.getByLabelText('Message type'), {
      target: { value: 'joining_onboarding' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview message' }));
    expect(await screen.findByText(/Message type must be one of/)).toBeTruthy();
  });

  test('says so when copying fails', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: async () => {
          throw new Error('denied');
        },
      },
      configurable: true,
    });
    document.execCommand = vi.fn(() => false);
    fakeBackend({ 'POST /candidates/3/messages/preview': READY });
    show(['notifications.manage']);
    fireEvent.change(screen.getByLabelText('Message type'), {
      target: { value: 'interview_invitation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview message' }));
    await screen.findByLabelText('Message text');
    fireEvent.click(screen.getByRole('button', { name: 'Copy Message' }));
    expect(await screen.findByText(/Copy failed/)).toBeTruthy();
  });
});

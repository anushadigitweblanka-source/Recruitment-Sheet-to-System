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
    email: 'test.user@example.test',
    fullName: 'Test User',
    role: { code: 'main_user', name: 'Main User' },
    permissions: ['candidates.view', 'notifications.manage', 'admin.manage'],
  },
  login: async () => ({ ok: true }),
  logout: async () => ({ ok: true }),
};

const notification = (id, overrides = {}) => ({
  id,
  candidate: {
    id,
    candidateCode: `TEST-${String(id).padStart(3, '0')}`,
    fullName: `Sample Person ${id}`,
  },
  type: 'cv_pending',
  dueAt: '2026-12-01T12:00:00.000Z',
  sendAt: '2026-11-30T12:00:00.000Z',
  sentAt: null,
  recipients: ['hr.sample@example.test'],
  status: 'pending',
  attempts: 0,
  lastError: null,
  ...overrides,
});

const template = (id, overrides = {}) => ({
  id,
  type: `sample_type_${id}`,
  subject: `Sample subject ${id}`,
  body: `Sample body ${id}`,
  sendMode: 'review',
  isActive: true,
  updatedAt: '2026-10-13T06:00:00.000Z',
  ...overrides,
});

const logEntry = (id, overrides = {}) => ({
  id,
  candidate: { id: 1, candidateCode: 'TEST-001', fullName: 'Sample Person 1' },
  template: { id: 1, type: 'sample_type_1' },
  notificationId: null,
  toAddresses: ['hr.sample@example.test'],
  subjectSent: `Sample subject ${id}`,
  status: 'sent',
  error: null,
  isResend: false,
  sentBy: null,
  sentAt: '2026-10-14T05:00:00.000Z',
  createdAt: '2026-10-14T05:00:00.000Z',
  ...overrides,
});

function fakeBackend({
  notifications = [],
  templates = [],
  log = [],
  approvals = [],
  listFails = 0,
} = {}) {
  const state = {
    notifications: structuredClone(notifications),
    templates: structuredClone(templates),
    log: structuredClone(log),
    approvals: structuredClone(approvals),
    calls: [],
    listFails,
    nextId: 900,
  };
  const json = (status, data) => ({ ok: status < 400, status, json: async () => data });
  const paged = (items) => ({
    items,
    total: items.length,
    page: 1,
    pageSize: 20,
    mailMode: 'development',
  });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (address, options = {}) => {
      const url = new URL(address, 'http://test.local');
      const method = options.method ?? 'GET';
      const body = options.body ? JSON.parse(options.body) : null;
      state.calls.push({
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        method,
        body,
      });
      const path = url.pathname.replace('/api', '');

      if (path === '/notifications' && method === 'GET') {
        if (state.listFails > 0) {
          state.listFails -= 1;
          return json(500, { error: 'Internal server error' });
        }
        const { type, status, search } = Object.fromEntries(url.searchParams);
        let found = state.notifications;
        if (type) found = found.filter((n) => n.type === type);
        if (status) found = found.filter((n) => n.status === status);
        if (search)
          found = found.filter((n) =>
            n.candidate.fullName.toLowerCase().includes(search.toLowerCase()),
          );
        return json(200, paged(found));
      }
      if (path === '/notifications/run' && method === 'POST') {
        // The run sends every pending reminder in this pretend backend.
        let sent = 0;
        for (const n of state.notifications) {
          if (n.status === 'pending') {
            n.status = 'sent';
            n.sentAt = '2026-10-14T05:10:00.000Z';
            sent += 1;
          }
        }
        return json(200, { mode: 'development', checked: sent, sent, failed: 0, skipped: 0 });
      }
      if (path === '/email-templates' && method === 'GET')
        return json(200, { items: state.templates });
      if (path === '/email-templates' && method === 'POST') {
        if (!body.subject) {
          return json(422, {
            error: 'validation_failed',
            message: 'x',
            fields: { subject: 'Subject is required.' },
          });
        }
        const created = template((state.nextId += 1), body);
        state.templates.push(created);
        return json(201, { template: created });
      }
      const patchTemplate = path.match(/^\/email-templates\/(\d+)$/);
      if (patchTemplate && method === 'PATCH') {
        const found = state.templates.find((t) => t.id === Number(patchTemplate[1]));
        Object.assign(found, body);
        return json(200, { template: found });
      }
      if (path === '/email-log' && method === 'GET') {
        const { status, recipient } = Object.fromEntries(url.searchParams);
        let found = state.log;
        if (status) found = found.filter((e) => e.status === status);
        if (recipient) found = found.filter((e) => e.toAddresses.join(',').includes(recipient));
        return json(200, paged(found));
      }
      if (path === '/email-approvals' && method === 'GET')
        return json(200, { items: state.approvals });
      const approvalAction = path.match(/^\/email-log\/(\d+)\/(approve|reject)$/);
      if (approvalAction && method === 'POST') {
        const index = state.approvals.findIndex((item) => item.id === Number(approvalAction[1]));
        if (index < 0) return json(404, { error: 'Not found' });
        const [item] = state.approvals.splice(index, 1);
        const entry = logEntry((state.nextId += 1), {
          candidate: item.candidate,
          subjectSent: item.subject,
          status: approvalAction[2] === 'approve' ? 'sent' : 'rejected',
          sentBy: 'Test User',
        });
        state.log.unshift(entry);
        return json(200, { entry });
      }
      const resend = path.match(/^\/email-log\/(\d+)\/resend$/);
      if (resend && method === 'POST') {
        const original = state.log.find((e) => e.id === Number(resend[1]));
        const entry = logEntry((state.nextId += 1), {
          subjectSent: original.subjectSent,
          isResend: true,
          sentBy: 'Test User',
        });
        state.log.unshift(entry);
        return json(201, { entry });
      }
      return json(404, { error: 'Not found' });
    }),
  );
  return state;
}

function open(path, user = SIGNED_IN.user) {
  return render(
    <AuthContext.Provider value={{ ...SIGNED_IN, user }}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const callsTo = (backend, method, path) =>
  backend.calls.filter((call) => call.method === method && call.path === path);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('notifications list', () => {
  test('shows the schedule with statuses, times and recipients', async () => {
    fakeBackend({
      notifications: [
        notification(1),
        notification(2, { status: 'sent', sentAt: '2026-11-30T12:05:00.000Z' }),
        notification(3, { status: 'failed', lastError: 'simulated' }),
        notification(4, { status: 'cancelled' }),
      ],
    });
    open('/notifications');

    const row = (await screen.findByText('TEST-001 — Sample Person 1')).closest('tr');
    expect(within(row).getByText('CV Pending')).toBeTruthy();
    expect(within(row).getByText('Scheduled')).toBeTruthy();
    expect(within(row).getByText('hr.sample@example.test')).toBeTruthy();
    // 2026-11-30T12:00Z is 17:30 office time (Asia/Colombo).
    expect(within(row).getByText('30 Nov 2026, 17:30')).toBeTruthy();

    const rowOf = (code) => screen.getByText(new RegExp(code)).closest('tr');
    expect(within(rowOf('TEST-002')).getByText('Sent')).toBeTruthy();
    expect(within(rowOf('TEST-003')).getByText('Failed')).toBeTruthy();
    expect(within(rowOf('TEST-004')).getByText('Cancelled')).toBeTruthy();
    expect(screen.getByText(/development mode: no real email/)).toBeTruthy();
  });

  test('says so when nothing is scheduled', async () => {
    fakeBackend();
    open('/notifications');

    expect(await screen.findByText('No notifications yet')).toBeTruthy();
  });

  test('shows an error when the backend fails, and Try again recovers', async () => {
    fakeBackend({ notifications: [notification(1)], listFails: 1 });
    open('/notifications');

    expect(await screen.findByText('The notifications could not be loaded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('TEST-001 — Sample Person 1')).toBeTruthy();
  });

  test('type and status filters are sent to the backend', async () => {
    const backend = fakeBackend({ notifications: [notification(1)] });
    open('/notifications');
    await screen.findByText('TEST-001 — Sample Person 1');

    fireEvent.change(screen.getByLabelText('Notification Type'), {
      target: { value: 'probation_end' },
    });
    await waitFor(() =>
      expect(callsTo(backend, 'GET', '/api/notifications').at(-1).query.type).toBe('probation_end'),
    );

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'failed' } });
    await waitFor(() =>
      expect(callsTo(backend, 'GET', '/api/notifications').at(-1).query.status).toBe('failed'),
    );
  });

  test('the development run button triggers the job and refreshes the list', async () => {
    const backend = fakeBackend({ notifications: [notification(1)] });
    open('/notifications');
    await screen.findByText('Scheduled');

    fireEvent.click(screen.getByRole('button', { name: /Run sending job now/ }));

    expect(await screen.findByText(/Run finished: 1 sent, 0 failed/)).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/notifications/run')).toHaveLength(1);
    await waitFor(() => {
      const row = screen.getByText('TEST-001 — Sample Person 1').closest('tr');
      expect(within(row).getByText('Sent')).toBeTruthy();
    });
  });
});

describe('email templates', () => {
  test('lists templates with their active state', async () => {
    fakeBackend({ templates: [template(1), template(2, { isActive: false })] });
    open('/email-templates');

    const active = (await screen.findByText('sample_type_1')).closest('tr');
    expect(within(active).getByText('Active')).toBeTruthy();
    const inactive = screen.getByText('sample_type_2').closest('tr');
    expect(within(inactive).getByText('Inactive')).toBeTruthy();
  });

  test('says so when there are no templates, without inventing any', async () => {
    fakeBackend();
    open('/email-templates');

    expect(await screen.findByText('No templates yet')).toBeTruthy();
    expect(screen.getByText(/No wording is created automatically/)).toBeTruthy();
  });

  test('creates a template and sends exactly the typed values', async () => {
    const backend = fakeBackend();
    open('/email-templates');
    await screen.findByText('No templates yet');

    fireEvent.click(screen.getByRole('button', { name: 'New template' }));
    fireEvent.change(screen.getByLabelText(/^Template Type/), {
      target: { value: 'joining_onboarding' },
    });
    fireEvent.change(screen.getByLabelText(/^Subject/), { target: { value: 'Hello {name}' } });
    fireEvent.change(screen.getByLabelText(/^Body/), { target: { value: 'Sample text.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));

    expect(await screen.findByText('Template saved.')).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/email-templates')[0].body).toEqual({
      type: 'joining_onboarding',
      subject: 'Hello {name}',
      body: 'Sample text.',
      sendMode: 'one_click',
      isActive: true,
    });
    expect(await screen.findByText('joining_onboarding')).toBeTruthy();
  });

  test('shows a backend refusal next to the field and saves nothing', async () => {
    fakeBackend();
    open('/email-templates');
    await screen.findByText('No templates yet');

    fireEvent.click(screen.getByRole('button', { name: 'New template' }));
    fireEvent.change(screen.getByLabelText(/^Template Type/), {
      target: { value: 'team_lead_summary' },
    });
    fireEvent.change(screen.getByLabelText(/^Subject/), { target: { value: 'S' } });
    fireEvent.change(screen.getByLabelText(/^Body/), { target: { value: 'B' } });
    // The pretend backend refuses an empty subject; empty it client-side first.
    fireEvent.change(screen.getByLabelText(/^Subject/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));

    expect(await screen.findByText('Subject is required.')).toBeTruthy();
    expect(screen.queryByText('Template saved.')).toBeNull();
  });

  test('edits an existing template', async () => {
    const backend = fakeBackend({ templates: [template(1)] });
    open('/email-templates');
    await screen.findByText('sample_type_1');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByLabelText(/^Subject/).value).toBe('Sample subject 1');
    fireEvent.change(screen.getByLabelText(/^Subject/), { target: { value: 'Changed subject' } });
    fireEvent.click(screen.getByLabelText(/^Active/));
    fireEvent.click(screen.getByRole('button', { name: 'Save template' }));

    expect(await screen.findByText('Template saved.')).toBeTruthy();
    const sent = callsTo(backend, 'PATCH', '/api/email-templates/1')[0].body;
    expect(sent.subject).toBe('Changed subject');
    expect(sent.isActive).toBe(false);
  });
});

describe('email log', () => {
  const approval = (id, overrides = {}) => ({
    id,
    candidate: { id: 1, fullName: 'Sample Person 1' },
    to: ['hr.sample@example.test'],
    subject: 'Sample joining details',
    body: 'A fictional offer email awaiting review.',
    preparedBy: 'Sample HR User',
    ...overrides,
  });

  test('Main User can approve a prepared offer mail and the waiting item clears', async () => {
    const backend = fakeBackend({ approvals: [approval(31)] });
    open('/email-log');

    expect(await screen.findByText('Offer mails waiting for the Main User')).toBeTruthy();
    expect(screen.getByText('A fictional offer email awaiting review.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Approve and send' }));

    expect(await screen.findByText('Approved and sent.')).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/email-log/31/approve')).toHaveLength(1);
    await waitFor(() =>
      expect(screen.queryByText('A fictional offer email awaiting review.')).toBeNull(),
    );
  });

  test('Main User can reject a prepared offer mail', async () => {
    const backend = fakeBackend({ approvals: [approval(32)] });
    open('/email-log');
    await screen.findByText('Offer mails waiting for the Main User');

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));

    expect(await screen.findByText('Rejected.')).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/email-log/32/reject')).toHaveLength(1);
  });

  test('HR can see pending offer mail but cannot approve or reject it', async () => {
    fakeBackend({ approvals: [approval(33)] });
    open('/email-log', {
      ...SIGNED_IN.user,
      role: { code: 'hr', name: 'HR' },
      permissions: ['notifications.manage'],
    });

    expect(await screen.findByText('Offer mails waiting for the Main User')).toBeTruthy();
    expect(screen.getByText('Only the Main User can approve this mail.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve and send' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
  });

  test('shows deliveries, failures and resend marks', async () => {
    fakeBackend({
      log: [
        logEntry(1),
        logEntry(2, { status: 'failed', error: 'simulated outage', sentAt: null }),
        logEntry(3, { isResend: true, sentBy: 'Test User' }),
      ],
    });
    open('/email-log');

    const sent = (await screen.findAllByText('hr.sample@example.test'))[0].closest('tr');
    expect(within(sent).getByText('Sent')).toBeTruthy();
    expect(screen.getByText('simulated outage')).toBeTruthy();
    expect(screen.getByText('Resent by Test User')).toBeTruthy();
    expect(screen.getByText(/development mode: no real email/)).toBeTruthy();
  });

  test('says so when no mail has been attempted', async () => {
    fakeBackend();
    open('/email-log');

    expect(await screen.findByText('No mails yet')).toBeTruthy();
  });

  test('recipient and status filters are sent to the backend', async () => {
    const backend = fakeBackend({ log: [logEntry(1)] });
    open('/email-log');
    await screen.findByText('sample_type_1');

    fireEvent.change(screen.getByLabelText('Recipient'), { target: { value: 'hr.sample' } });
    await waitFor(() =>
      expect(callsTo(backend, 'GET', '/api/email-log').at(-1).query.recipient).toBe('hr.sample'),
    );
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'failed' } });
    await waitFor(() =>
      expect(callsTo(backend, 'GET', '/api/email-log').at(-1).query.status).toBe('failed'),
    );
  });

  test('an explicit resend calls the backend and the new row appears', async () => {
    const backend = fakeBackend({ log: [logEntry(1)] });
    open('/email-log');
    await screen.findByText('sample_type_1');

    fireEvent.click(screen.getByRole('button', { name: 'Resend mail 1' }));

    expect(await screen.findByText(/^Resent "Sample subject 1"/)).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/email-log/1/resend')).toHaveLength(1);
    expect(await screen.findByText('Resent by Test User')).toBeTruthy();
  });
});

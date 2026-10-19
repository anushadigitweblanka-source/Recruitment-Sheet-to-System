// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { AuthContext } from '../src/auth/AuthContext.jsx';
import CandidateEmailPanel from '../src/modules/notifications/CandidateEmailPanel.jsx';
import SalaryPanel from '../src/modules/offers/SalaryPanel.jsx';
import CompanyAccountsPage from '../src/pages/CompanyAccountsPage.jsx';
import CompanyCvUploadPage from '../src/pages/CompanyCvUploadPage.jsx';
import { isInMenuFor } from '../src/navigation.js';
import SettingsPage from '../src/pages/SettingsPage.jsx';
import TeamLeadsPage from '../src/pages/TeamLeadsPage.jsx';

// Stage 11 screens. Every name, address and amount is made up; the backend is
// a pretend one that records what the screens send.

const as = (permissions) => ({
  status: 'authenticated',
  user: {
    id: 1,
    email: 'test.user@example.test',
    fullName: 'Test User',
    role: { code: 'main_user', name: 'Main User' },
    permissions,
  },
  login: async () => ({ ok: true }),
  logout: async () => ({ ok: true }),
});

const json = (status, data) => ({ ok: status < 400, status, json: async () => data });

// routes: { 'GET /path': (body, url) => response | value }
function fakeBackend(routes) {
  const calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (address, options = {}) => {
      const url = new URL(address, 'http://test.local');
      const method = options.method ?? 'GET';
      const isFile = options.body && typeof options.body !== 'string';
      const body = options.body && !isFile ? JSON.parse(options.body) : null;
      const path = url.pathname.replace('/api', '');
      calls.push({
        method,
        path,
        body,
        file: isFile ? options.body : null,
        headers: options.headers,
      });
      const handler = routes[`${method} ${path}`];
      if (!handler) return json(404, { error: 'not_found' });
      const result = typeof handler === 'function' ? handler(body, url) : handler;
      return result?.status ? result : json(200, result);
    }),
  );
  return {
    calls,
    to: (method, path) => calls.filter((c) => c.method === method && c.path === path),
  };
}

function withAuth(user, element, path = '/') {
  return render(
    <AuthContext.Provider value={user}>
      <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('salary panel', () => {
  test('is only a notice for anyone without salary.view, and asks the server for nothing', async () => {
    const backend = fakeBackend({});
    withAuth(as(['candidates.view', 'offers.manage']), <SalaryPanel candidateId={7} />);

    expect(screen.getByText(/visible and editable by the Main User only/)).toBeTruthy();
    expect(screen.queryByLabelText(/Salary \(LKR\)/)).toBeNull();
    expect(backend.calls).toEqual([]);
  });

  test('shows the saved amount to the Main User and saves a change', async () => {
    const backend = fakeBackend({
      'GET /salary/7': { salary: { candidateId: 7, salaryLkr: 150000, updatedAt: 'x' } },
      'PUT /salary/7': (body) => ({
        salary: { candidateId: 7, salaryLkr: Number(body.salaryLkr), updatedAt: 'y' },
      }),
    });
    withAuth(as(['salary.view', 'salary.edit']), <SalaryPanel candidateId={7} />);

    const field = await screen.findByLabelText(/Salary \(LKR\)/);
    await waitFor(() => expect(field.value).toBe('150000'));
    fireEvent.change(field, { target: { value: '175000.50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save salary' }));

    expect(await screen.findByText('Salary saved.')).toBeTruthy();
    expect(backend.to('PUT', '/salary/7')[0].body).toEqual({ salaryLkr: '175000.50' });
  });

  test('shows the server’s refusal of a bad amount', async () => {
    fakeBackend({
      'GET /salary/7': { salary: null },
      'PUT /salary/7': json(422, { fields: { salaryLkr: 'Salary must be a number.' } }),
    });
    withAuth(as(['salary.view', 'salary.edit']), <SalaryPanel candidateId={7} />);

    const field = await screen.findByLabelText(/Salary \(LKR\)/);
    fireEvent.change(field, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save salary' }));
    expect(await screen.findByText('Salary must be a number.')).toBeTruthy();
  });

  test('a viewer without salary.edit sees the amount but cannot change it', async () => {
    fakeBackend({
      'GET /salary/7': { salary: { candidateId: 7, salaryLkr: 90000, updatedAt: 'x' } },
    });
    withAuth(as(['salary.view']), <SalaryPanel candidateId={7} />);
    const field = await screen.findByLabelText(/Salary \(LKR\)/);
    expect(field.disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save salary' })).toBeNull();
  });
});

describe('candidate email panel', () => {
  const PREVIEW = {
    type: 'interview_invitation',
    sendMode: 'one_click',
    to: ['candidate.sample@example.test'],
    cc: [],
    subject: 'Interview for Sample Person',
    body: 'Hello Sample Person.',
    missing: [],
    canSend: true,
  };

  test('is hidden from people who may not send mail', () => {
    fakeBackend({});
    withAuth(as(['candidates.view']), <CandidateEmailPanel candidateId={3} />);
    expect(screen.queryByText('Send an email')).toBeNull();
  });

  test('previews, lets one copy be edited, sends, and offers Resend when it was sent before', async () => {
    let sends = 0;
    const backend = fakeBackend({
      'POST /candidates/3/emails/preview': PREVIEW,
      'POST /candidates/3/emails/send': () => {
        sends += 1;
        return sends === 1
          ? json(201, { logId: 1, delivered: true })
          : sends === 2
            ? json(422, {
                fields: { mail: 'This mail was already sent. Use Resend to send it again.' },
              })
            : json(201, { logId: 2, delivered: true });
      },
    });
    withAuth(as(['notifications.manage']), <CandidateEmailPanel candidateId={3} />);

    fireEvent.change(screen.getByLabelText('Mail type'), {
      target: { value: 'interview_invitation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByDisplayValue('Interview for Sample Person')).toBeTruthy();
    expect(screen.getByText('candidate.sample@example.test', { exact: false })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Edited subject' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/Mail sent and recorded/)).toBeTruthy();
    expect(backend.to('POST', '/candidates/3/emails/send')[0].body).toEqual({
      type: 'interview_invitation',
      subject: 'Edited subject',
      body: 'Hello Sample Person.',
      resend: false,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/already sent/)).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Resend' }));
    await waitFor(() =>
      expect(backend.to('POST', '/candidates/3/emails/send')[2].body.resend).toBe(true),
    );
  });

  test('cannot send while something required is missing, and says what', async () => {
    fakeBackend({
      'POST /candidates/3/emails/preview': {
        ...PREVIEW,
        to: [],
        missing: ['candidate email'],
        canSend: false,
      },
    });
    withAuth(as(['notifications.manage']), <CandidateEmailPanel candidateId={3} />);

    fireEvent.change(screen.getByLabelText('Mail type'), {
      target: { value: 'interview_invitation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));

    expect(await screen.findByText(/Missing: candidate email/)).toBeTruthy();
    expect(screen.getByText(/Add the candidate’s email address/)).toBeTruthy();
    expect(screen.getByText(/Send is unavailable until/)).toBeTruthy();
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send.disabled).toBe(true);
    expect(send.getAttribute('aria-describedby')).toBe('send-unavailable');
  });

  test('explains a missing interview time with the step to take', async () => {
    fakeBackend({
      'POST /candidates/3/emails/preview': {
        ...PREVIEW,
        missing: ['interview date and time'],
        canSend: false,
      },
    });
    withAuth(as(['notifications.manage']), <CandidateEmailPanel candidateId={3} />);
    fireEvent.change(screen.getByLabelText('Mail type'), {
      target: { value: 'interview_invitation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText(/Record the phone interview as Selected/)).toBeTruthy();
  });

  test('in development mode says so, and never claims a real delivery', async () => {
    fakeBackend({
      'POST /candidates/3/emails/preview': { ...PREVIEW, deliveryMode: 'development' },
      'POST /candidates/3/emails/send': json(201, {
        logId: 1,
        delivered: true,
        simulated: true,
        deliveryMode: 'development',
      }),
    });
    withAuth(as(['notifications.manage']), <CandidateEmailPanel candidateId={3} />);
    fireEvent.change(screen.getByLabelText('Mail type'), {
      target: { value: 'interview_invitation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
    expect(await screen.findByText('Development mode')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/no real email was delivered/)).toBeTruthy();
    expect(screen.queryByText(/Mail sent and recorded/)).toBeNull();
  });
});

describe('team leads', () => {
  test('lists the mapping, adds a Team Lead and switches one off', async () => {
    const lead = {
      id: 5,
      position: { id: 2, name: 'Sample Position' },
      teamName: null,
      name: 'Sample Lead',
      email: 'lead.sample@example.test',
      userId: null,
      isActive: true,
    };
    const backend = fakeBackend({
      'GET /admin/team-leads': { items: [lead] },
      'GET /lookups/positions': {
        items: [
          { id: 2, name: 'Sample Position', isActive: true },
          { id: 3, name: 'Other Position', isActive: true },
        ],
      },
      'GET /admin/users': { items: [] },
      'POST /admin/team-leads': (body) => json(201, { teamLead: { ...lead, ...body, id: 6 } }),
      'PATCH /admin/team-leads/5': { teamLead: { ...lead, isActive: false } },
    });
    withAuth(
      as(['admin.manage']),
      <TeamLeadsPage page={{ label: 'Team Leads', description: 'Mapping' }} />,
    );

    expect(await screen.findByText('Sample Lead')).toBeTruthy();
    expect(screen.getByText('lead.sample@example.test')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/^Position/), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(/^Team Lead name/), { target: { value: 'New Lead' } });
    fireEvent.change(screen.getByLabelText(/^Team Lead email/), {
      target: { value: 'new.lead@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save Team Lead' }));
    expect(await screen.findByText('Team Lead saved.')).toBeTruthy();
    expect(backend.to('POST', '/admin/team-leads')[0].body).toEqual({
      positionId: 3,
      teamName: '',
      name: 'New Lead',
      email: 'new.lead@example.test',
      userId: null,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() =>
      expect(backend.to('PATCH', '/admin/team-leads/5')[0].body).toEqual({ isActive: false }),
    );
  });

  test('shows the server’s field refusals', async () => {
    fakeBackend({
      'GET /admin/team-leads': { items: [] },
      'GET /lookups/positions': { items: [] },
      'GET /admin/users': { items: [] },
      'POST /admin/team-leads': json(422, {
        fields: { email: 'Team Lead Email is not a valid address.' },
      }),
    });
    withAuth(as(['admin.manage']), <TeamLeadsPage page={{ label: 'Team Leads' }} />);
    await screen.findByText('No Team Leads yet');
    fireEvent.click(screen.getByRole('button', { name: 'Save Team Lead' }));
    expect(await screen.findByText('Team Lead Email is not a valid address.')).toBeTruthy();
  });
});

describe('company accounts', () => {
  const account = (overrides = {}) => ({
    id: 11,
    candidate: { id: 4, candidateCode: 'S-1', fullName: 'Account Sample' },
    employeeId: 2,
    companyEmail: null,
    status: 'requested',
    requestedAt: '2026-10-14T05:00:00.000Z',
    createdDate: null,
    handedOverDate: null,
    disablePending: false,
    disabledDate: null,
    hasStoredPassword: false,
    ...overrides,
  });
  const page = { label: 'Company Accounts', description: 'x' };

  test('IT marks a requested account Created with the company email', async () => {
    const backend = fakeBackend({
      'GET /company-accounts': { items: [account()], total: 1 },
      'POST /company-accounts/11/created': { account: account({ status: 'created' }) },
    });
    withAuth(as(['company_accounts.manage']), <CompanyAccountsPage page={page} />);

    expect(await screen.findByText('Account Sample')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Company email (IT)'), {
      target: { value: 'account.sample@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Mark Created' }));

    await waitFor(() =>
      expect(backend.to('POST', '/company-accounts/11/created')[0].body).toEqual({
        companyEmail: 'account.sample@example.test',
      }),
    );
    // No password tools for someone without company_accounts.password.
    expect(screen.queryByText('Password tools')).toBeNull();
  });

  test('a created account can be handed over, and a pending disable completed', async () => {
    const backend = fakeBackend({
      'GET /company-accounts': {
        items: [
          account({ id: 11, status: 'created', companyEmail: 'a@example.test' }),
          account({
            id: 12,
            candidate: { id: 5, candidateCode: 'S-2', fullName: 'Leaver Sample' },
            status: 'handed_over',
            companyEmail: 'b@example.test',
            disablePending: true,
          }),
        ],
        total: 2,
      },
      'POST /company-accounts/11/handed-over': { account: account({ status: 'handed_over' }) },
      'POST /company-accounts/12/disabled': { account: account({ status: 'disabled' }) },
    });
    withAuth(as(['company_accounts.manage']), <CompanyAccountsPage page={page} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Mark Handed over' }));
    await waitFor(() =>
      expect(backend.to('POST', '/company-accounts/11/handed-over')).toHaveLength(1),
    );
    // The list reloads after a change; then the second action is available.
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Disabled (completed)' }));
    await waitFor(() =>
      expect(backend.to('POST', '/company-accounts/12/disabled')).toHaveLength(1),
    );
  });

  test('the temporary password is masked, revealed only with the login password, and hidden after 30 seconds', async () => {
    const backend = fakeBackend({
      'GET /company-accounts': {
        items: [
          account({ status: 'created', companyEmail: 'a@example.test', hasStoredPassword: true }),
        ],
        total: 1,
      },
      'POST /company-accounts/11/password/reveal': (body) =>
        body.loginPassword === 'right-login-password'
          ? { password: 'Sample-Temp-Pass', revealSeconds: 30 }
          : json(422, { fields: { loginPassword: 'That password is not correct.' } }),
    });
    withAuth(
      as(['company_accounts.manage', 'company_accounts.password']),
      <CompanyAccountsPage page={page} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Password tools' }));
    expect(screen.queryByText('Sample-Temp-Pass')).toBeNull();
    expect(screen.getByText(/••••/)).toBeTruthy();

    const login = screen.getByLabelText(/Your own login password/);
    fireEvent.change(login, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reveal for 30 seconds' }));
    expect(await screen.findByText('That password is not correct.')).toBeTruthy();
    expect(screen.queryByText('Sample-Temp-Pass')).toBeNull();

    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(login, { target: { value: 'right-login-password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reveal for 30 seconds' }));
    expect(await screen.findByText('Sample-Temp-Pass')).toBeTruthy();
    expect(backend.to('POST', '/company-accounts/11/password/reveal')).toHaveLength(2);

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.queryByText('Sample-Temp-Pass')).toBeNull();
  });
});

describe('company CV upload page (the candidate’s own link)', () => {
  const open = (token = 'sample-token-1234567890') =>
    render(
      <MemoryRouter initialEntries={[`/company-cv/upload/${token}`]}>
        <Routes>
          <Route path="/company-cv/upload/:token" element={<CompanyCvUploadPage />} />
        </Routes>
      </MemoryRouter>,
    );
  const pdf = (name = 'sample.pdf') =>
    new File(['%PDF-1.4 sample'], name, { type: 'application/pdf' });

  test('uploads a PDF through the link, with nothing about the candidate on the page', async () => {
    const backend = fakeBackend({
      'GET /public/company-cv/sample-token-1234567890': { ok: true },
      'PUT /public/company-cv/sample-token-1234567890': json(201, { ok: true }),
    });
    open();

    const input = await screen.findByLabelText('Company CV file');
    expect(document.body.textContent).not.toMatch(/@/);
    fireEvent.change(input, { target: { files: [pdf()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));

    expect(await screen.findByText(/Your Company CV has been received/)).toBeTruthy();
    const put = backend.to('PUT', '/public/company-cv/sample-token-1234567890')[0];
    expect(put.file.type).toBe('application/pdf');
    expect(put.headers['Content-Type']).toBe('application/pdf');
  });

  test('refuses a file that is not a PDF or Word document before sending anything', async () => {
    const backend = fakeBackend({
      'GET /public/company-cv/sample-token-1234567890': { ok: true },
    });
    open();
    const input = await screen.findByLabelText('Company CV file');
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] },
    });

    expect(await screen.findByText('Please choose a PDF or Word document.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload' }).disabled).toBe(true);
    expect(backend.to('PUT', '/public/company-cv/sample-token-1234567890')).toHaveLength(0);
  });

  test('says plainly when the link is used, expired or not valid', async () => {
    fakeBackend({
      'GET /public/company-cv/sample-token-1234567890': json(410, { error: 'already_used' }),
    });
    open();
    expect(await screen.findByText(/already been used or has expired/)).toBeTruthy();
    expect(screen.queryByLabelText('Company CV file')).toBeNull();
  });

  test('says so when the link is not valid at all', async () => {
    fakeBackend({});
    open('nonsense-token-abcdefghijklmnop');
    expect(await screen.findByText(/not valid/)).toBeTruthy();
  });
});

describe('settings', () => {
  const setting = (key, value, description = 'Sample description') => ({
    key,
    value,
    description,
    updatedAt: '2026-10-14T05:00:00.000Z',
  });

  test('address, venue and yes/no settings are edited as text, not as day counts', async () => {
    const backend = fakeBackend({
      'GET /admin/settings': {
        items: [
          setting('evaluation_days', '7'),
          setting('reminder_hr_emails', ''),
          setting('evaluation_reminder_include_candidate', 'false'),
        ],
      },
      'PATCH /admin/settings/reminder_hr_emails': (body) => ({
        setting: setting('reminder_hr_emails', body.value),
      }),
    });
    withAuth(as(['admin.manage']), <SettingsPage page={{ label: 'Settings', description: 'x' }} />);

    const days = await screen.findByLabelText('Evaluation length (days)');
    expect(days.type).toBe('number');
    const hr = screen.getByLabelText('HR addresses for reminders');
    expect(hr.type).toBe('text');
    const include = screen.getByLabelText('Also send the evaluation reminder to the candidate');
    expect(include.tagName).toBe('SELECT');
    expect(include.value).toBe('false');

    fireEvent.change(hr, { target: { value: 'hr.sample@example.test' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Save' })[1]);
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(backend.to('PATCH', '/admin/settings/reminder_hr_emails')[0].body).toEqual({
      value: 'hr.sample@example.test',
    });
  });
});

describe('menu narrowing by role (the server stays the source of truth)', () => {
  test('a Team Lead sees only the candidate and interview pages', () => {
    const teamLead = ['candidates.view_team', 'interviews.score'];
    expect(isInMenuFor('/candidates', teamLead)).toBe(true);
    expect(isInMenuFor('/interviews', teamLead)).toBe(true);
    for (const path of [
      '/dashboard',
      '/offers',
      '/employees',
      '/reports',
      '/email-log',
      '/admin/users',
      '/admin/team-leads',
      '/admin/company-accounts',
    ]) {
      expect(isInMenuFor(path, teamLead), path).toBe(false);
    }
  });

  test('HR sees the working pages but not administration, except company accounts', () => {
    const hr = [
      'candidates.view',
      'candidates.edit',
      'interviews.manage',
      'notifications.manage',
      'company_accounts.manage',
    ];
    expect(isInMenuFor('/candidates', hr)).toBe(true);
    expect(isInMenuFor('/reports', hr)).toBe(true);
    expect(isInMenuFor('/admin/users', hr)).toBe(false);
    expect(isInMenuFor('/admin/settings', hr)).toBe(false);
    expect(isInMenuFor('/admin/company-accounts', hr)).toBe(true);
    expect(isInMenuFor('/admin/system-status', hr)).toBe(true);
  });

  test('without permission data nothing is hidden', () => {
    expect(isInMenuFor('/admin/users', undefined)).toBe(true);
  });
});

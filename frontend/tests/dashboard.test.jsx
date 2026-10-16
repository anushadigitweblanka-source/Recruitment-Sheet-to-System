// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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

const emptySummary = () => ({
  counts: {
    totalCandidates: 0,
    applied: 0,
    phoneScreened: 0,
    interviewsScheduled: 0,
    interviewed: 0,
    selected: 0,
    rejected: 0,
    onHold: 0,
    offersSent: 0,
    offersAccepted: 0,
    joined: 0,
    notAttended: 0,
    noResponse: 0,
    currentlyWorking: 0,
    discontinued: 0,
    terminated: 0,
  },
  employeePhases: { evaluation: 0, probation: 0, junior: 0, senior: 0 },
  upcomingInterviews: [],
  upcomingDeadlines: [],
});

const filledSummary = () => ({
  ...emptySummary(),
  counts: {
    ...emptySummary().counts,
    totalCandidates: 42,
    phoneScreened: 7,
    selected: 3,
    currentlyWorking: 5,
  },
  employeePhases: { evaluation: 1, probation: 2, junior: 2, senior: 0 },
  upcomingInterviews: [
    {
      id: 1,
      candidateCode: 'TEST-901',
      candidateName: 'Sample Person One',
      position: 'Sample Position',
      scheduledAt: '2026-11-20T04:30:00.000Z',
      interviewer: 'Sample Interviewer',
      stage: 'Interview Scheduled',
    },
  ],
  upcomingDeadlines: [
    {
      id: 11,
      candidateCode: 'TEST-902',
      employeeName: 'Sample Person Two',
      position: 'Sample Position',
      phase: 'probation',
      endDate: '2026-10-18',
      daysRemaining: 4,
    },
  ],
});

function mockSummary({ summary, fail = false, never = false } = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (address) => {
      const url = new URL(address, 'http://test.local');
      if (url.pathname === '/api/dashboard/summary') {
        if (never) return new Promise(() => {});
        if (fail) {
          return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
        }
        return new Response(JSON.stringify(summary ?? emptySummary()), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
}

function renderDashboard() {
  return render(
    <AuthContext.Provider value={SIGNED_IN}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <App />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('dashboard page', () => {
  test('shows a loading state while the summary is being fetched', () => {
    mockSummary({ never: true });
    renderDashboard();
    expect(screen.getByText('Loading dashboard…')).toBeTruthy();
  });

  test('renders the counts from the API', async () => {
    mockSummary({ summary: filledSummary() });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Recruitment Summary')).toBeTruthy());
    expect(screen.getByText('Total Candidates').closest('.stat-card').textContent).toContain('42');
    expect(screen.getByText('Phone Screened').closest('.stat-card').textContent).toContain('7');
    expect(screen.getByText('Currently Working').closest('.stat-card').textContent).toContain('5');
    const lifecycle = screen.getByText('Employee Lifecycle').closest('section');
    expect(within(lifecycle).getByText('Probation').closest('.stat-card').textContent).toContain(
      '2',
    );
  });

  test('zero counts render as 0, never as sample numbers or --', async () => {
    mockSummary({ summary: emptySummary() });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Recruitment Summary')).toBeTruthy());
    expect(screen.getByText('Total Candidates').closest('.stat-card').textContent).toContain('0');
    expect(screen.queryByText('Not available yet')).toBeNull();
  });

  test('renders upcoming interviews and deadlines', async () => {
    mockSummary({ summary: filledSummary() });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('Upcoming Interviews')).toBeTruthy());

    const interviews = screen.getByRole('table', { name: 'Upcoming interviews' });
    expect(within(interviews).getByText('Sample Person One (TEST-901)')).toBeTruthy();
    expect(within(interviews).getByText('Sample Interviewer')).toBeTruthy();

    const deadlines = screen.getByRole('table', { name: 'Upcoming employee deadlines' });
    expect(within(deadlines).getByText('Sample Person Two (TEST-902)')).toBeTruthy();
    expect(within(deadlines).getByText('4 day(s)')).toBeTruthy();
    expect(within(deadlines).getByText('Probation')).toBeTruthy();
  });

  test('shows empty messages when there are no interviews or deadlines', async () => {
    mockSummary({ summary: emptySummary() });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('No upcoming interviews')).toBeTruthy());
    expect(screen.getByText('No deadlines in the next 7 days')).toBeTruthy();
  });

  describe('Recruitment Records figures', () => {
    const withRecords = (overrides = {}) => ({
      ...filledSummary(),
      recruitmentRecords: {
        totalRecords: 408,
        historicalInterviewRecords: 404,
        currentCandidateProfiles: 4,
        historicalOutcomes: [
          { status: 'Selected', count: 120 },
          { status: 'Rejected', count: 90 },
          { status: 'On Hold', count: 12 },
          { status: null, count: 23 },
        ],
        ...overrides,
      },
    });
    const card = (name) => screen.getByText(name).closest('.stat-card').textContent;

    test('shows the total, historical and current profile counts', async () => {
      mockSummary({ summary: withRecords() });
      renderDashboard();
      const section = (await screen.findByText('Recruitment Records')).closest('section');
      expect(
        within(section).getByText('Total Recruitment Records').closest('.stat-card').textContent,
      ).toContain('408');
      expect(
        within(section).getByText('Historical Interview Records').closest('.stat-card').textContent,
      ).toContain('404');
      expect(
        within(section).getByText('Current Candidate Profiles').closest('.stat-card').textContent,
      ).toContain('4');
    });

    test('shows each original interview outcome, with blanks labelled, apart from live stages', async () => {
      mockSummary({ summary: withRecords() });
      renderDashboard();
      const outcomes = (await screen.findByText('Historical Interview Outcomes')).closest(
        'section',
      );
      for (const [label, count] of [
        ['Selected', '120'],
        ['Rejected', '90'],
        ['On Hold', '12'],
        ['(blank)', '23'],
      ]) {
        expect(within(outcomes).getByText(label).closest('.stat-card').textContent).toContain(
          count,
        );
      }
      expect(within(outcomes).getByText(/not unique candidates/)).toBeTruthy();

      // The live pipeline keeps its own, separate figures.
      const live = screen.getByText('Recruitment Summary').closest('section');
      expect(within(live).getByText('Selected').closest('.stat-card').textContent).toContain('3');
      expect(within(live).getByText(/current candidate profiles only/)).toBeTruthy();
      expect(card('Total Candidates')).toContain('42');
    });

    test('employee lifecycle, upcoming interviews and deadlines are still shown from their own data', async () => {
      mockSummary({ summary: withRecords() });
      renderDashboard();
      await screen.findByText('Recruitment Records');
      expect(card('Currently Working')).toContain('5');
      expect(
        within(screen.getByRole('table', { name: 'Upcoming interviews' })).getByText(
          'Sample Person One (TEST-901)',
        ),
      ).toBeTruthy();
      expect(screen.getByRole('table', { name: 'Upcoming employee deadlines' })).toBeTruthy();
    });

    test('without the record figures the dashboard looks exactly as before', async () => {
      mockSummary({ summary: filledSummary() });
      renderDashboard();
      await screen.findByText('Recruitment Summary');
      expect(screen.queryByText('Recruitment Records')).toBeNull();
      expect(screen.queryByText('Historical Interview Outcomes')).toBeNull();
      expect(screen.queryByText(/current candidate profiles only/)).toBeNull();
    });

    test('opening the dashboard again reads the new figures from the server', async () => {
      mockSummary({ summary: withRecords() });
      renderDashboard();
      const first = (await screen.findByText('Total Recruitment Records')).closest('.stat-card');
      expect(first.textContent).toContain('408');
      cleanup();

      // A candidate was added in the meantime: the next visit shows the new totals.
      mockSummary({
        summary: withRecords({ totalRecords: 409, currentCandidateProfiles: 5 }),
      });
      renderDashboard();
      const second = (await screen.findByText('Total Recruitment Records')).closest('.stat-card');
      expect(second.textContent).toContain('409');
      expect(card('Current Candidate Profiles')).toContain('5');
    });
  });

  test('shows an error state with retry when the API fails', async () => {
    mockSummary({ fail: true });
    renderDashboard();
    await waitFor(() => expect(screen.getByText('The dashboard could not be loaded')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});

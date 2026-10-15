// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.jsx';
import { AuthContext } from '../src/auth/AuthContext.jsx';

// Every name in this file is made up.

const SIGNED_IN = {
  status: 'authenticated',
  user: {
    id: 1,
    email: 'test.user@example.test',
    fullName: 'Test User',
    role: { code: 'main_user', name: 'Main User' },
    permissions: ['candidates.view', 'employees.manage'],
  },
  login: async () => ({ ok: true }),
  logout: async () => ({ ok: true }),
};

const ALLOWED = {
  evaluation: ['pass', 'discontinue'],
  probation: ['pass', 'extend', 'discontinue'],
  junior: ['pass', 'discontinue'],
  senior: [],
};
const NEXT = { evaluation: 'probation', probation: 'junior', junior: 'senior' };

const phaseRow = (id, phase, startDate, endDate, extra = {}) => ({
  id,
  phase,
  startDate,
  endDate,
  isExtension: false,
  result: null,
  resultReason: null,
  reviewDocUrl: null,
  reviewedBy: null,
  decidedAt: null,
  ...extra,
});

// One employee as the details route returns it.
function employee(id, { phase = 'evaluation', status = 'active', track = null, phases } = {}) {
  const rows = phases ?? [phaseRow(id * 10, 'evaluation', '2026-11-02', '2026-11-08')];
  const open = rows.find((row) => row.result === null);
  return {
    candidate: {
      id: id + 100,
      candidateCode: `TEST-${String(id).padStart(3, '0')}`,
      fullName: `Sample Person ${id}`,
      phone: `07100000${String(id).padStart(2, '0')}`,
    },
    employee: {
      id,
      position: 'Sample Position',
      joinDate: '2026-11-02',
      track,
      currentPhase: phase,
      phaseStart: open?.startDate ?? rows.at(-1).startDate,
      phaseEnd: open ? open.endDate : rows.at(-1).endDate,
      status,
      nextReview: status === 'active' && phase !== 'senior' ? (open?.endDate ?? null) : null,
      exitDate: status === 'active' ? null : '2026-12-01',
      exitReason: status === 'active' ? null : 'Sample exit reason',
      exitApprovedBy: status === 'terminated' ? 'Test User' : null,
      updatedAt: '2026-11-02T06:00:00.000Z',
      updatedBy: 'Test User',
    },
    phases: rows,
    decision:
      status === 'active' && open && ALLOWED[open.phase].length > 0
        ? {
            phaseId: open.id,
            phase: open.phase,
            allowedResults: ALLOWED[open.phase],
            needsEndDate: open.phase === 'junior' && !open.endDate,
            extensionLatestEnd: open.phase === 'probation' ? '2027-03-08' : null,
          }
        : null,
    canTerminate: status === 'active' && ['junior', 'senior'].includes(phase),
  };
}

const PROBATION_PHASES = [
  phaseRow(10, 'evaluation', '2026-11-02', '2026-11-08', {
    result: 'pass',
    reviewedBy: 'Test User',
    decidedAt: '2026-11-08T10:00:00.000Z',
    reviewDocUrl: 'https://example.test/review',
  }),
  phaseRow(11, 'probation', '2026-11-09', '2027-02-08'),
];
const JUNIOR_PHASES = [
  ...PROBATION_PHASES.slice(0, 1),
  phaseRow(11, 'probation', '2026-11-09', '2027-02-08', {
    result: 'pass',
    decidedAt: '2027-02-08T10:00:00.000Z',
  }),
  phaseRow(12, 'junior', '2027-02-09', null),
];

// A pretend backend holding employees in memory, with simplified decisions.
function fakeBackend({ employees = [], listFails = 0, hang = false, refuse = null } = {}) {
  const state = { employees: employees.map((e) => structuredClone(e)), calls: [], listFails };
  const json = (status, data) => ({ ok: status < 400, status, json: async () => data });
  const find = (id) => state.employees.find((e) => e.employee.id === Number(id));

  vi.stubGlobal(
    'fetch',
    vi.fn(async (address, options = {}) => {
      const url = new URL(address, 'http://test.local');
      const method = options.method ?? 'GET';
      const body = options.body ? JSON.parse(options.body) : null;
      const query = Object.fromEntries(url.searchParams);
      state.calls.push({ path: url.pathname, query, method, body });
      const path = url.pathname.replace('/api', '');

      if (path === '/employees' && method === 'GET') {
        if (hang) return new Promise(() => {});
        if (state.listFails > 0) {
          state.listFails -= 1;
          return json(500, { error: 'Internal server error' });
        }
        let found = state.employees;
        if (query.search)
          found = found.filter((e) =>
            e.candidate.fullName.toLowerCase().includes(query.search.toLowerCase()),
          );
        if (query.phase) found = found.filter((e) => e.employee.currentPhase === query.phase);
        if (query.status === 'exited') found = found.filter((e) => e.employee.status !== 'active');
        else if (query.status) found = found.filter((e) => e.employee.status === query.status);
        if (query.track) found = found.filter((e) => e.employee.track === query.track);
        return json(200, {
          items: found.map((e) => ({
            id: e.employee.id,
            candidate: {
              id: e.candidate.id,
              candidateCode: e.candidate.candidateCode,
              fullName: e.candidate.fullName,
            },
            position: e.employee.position,
            joinDate: e.employee.joinDate,
            track: e.employee.track,
            currentPhase: e.employee.currentPhase,
            phaseStart: e.employee.phaseStart,
            phaseEnd: e.employee.phaseEnd,
            status: e.employee.status,
            nextReview: e.employee.nextReview,
          })),
          total: found.length,
          page: 1,
          pageSize: 20,
        });
      }

      const action = path.match(/^\/employees\/(\d+)(?:\/(decision|termination))?$/);
      if (action) {
        const found = find(action[1]);
        if (!found) return json(404, { error: 'not_found', message: 'Employee not found.' });
        if (method === 'GET') return json(200, found);
        if (refuse) return json(422, { error: 'validation_failed', fields: refuse });
        if (method === 'PATCH') {
          found.employee.track = body.track;
          return json(200, found);
        }
        const id = found.employee.id;
        if (action[2] === 'termination') {
          const next = employee(id, {
            phase: found.employee.currentPhase,
            status: 'terminated',
            phases: found.phases,
          });
          Object.assign(found, next);
          return json(200, found);
        }
        const open = found.phases.find((row) => row.result === null);
        const decided = { ...open, result: body.result, decidedAt: '2026-11-08T10:00:00.000Z' };
        const rows = found.phases.map((row) => (row === open ? decided : row));
        let next;
        if (body.result === 'discontinue') {
          next = employee(id, { phase: open.phase, status: 'discontinued', phases: rows });
        } else {
          const phase = body.result === 'extend' ? 'probation' : NEXT[open.phase];
          rows.push(
            phaseRow(open.id + 1, phase, '2026-11-09', phase === 'probation' ? '2027-02-08' : null),
          );
          next = employee(id, { phase, phases: rows });
        }
        Object.assign(found, next);
        return json(200, found);
      }
      return json(404, { error: 'Not found' });
    }),
  );
  return state;
}

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}
const currentPath = () => screen.getByTestId('location').textContent;

function open(path) {
  return render(
    <AuthContext.Provider value={SIGNED_IN}>
      <MemoryRouter initialEntries={[path]}>
        <App />
        <LocationProbe />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const callsTo = (backend, method, path) =>
  backend.calls.filter((call) => call.method === method && call.path === path);
const optionsOf = (label) =>
  [...screen.getByLabelText(label).options].map((option) => option.textContent);
const value = (label) =>
  within(screen.getByText(label, { selector: 'dt' }).closest('div')).getByRole('definition')
    .textContent;
const steps = () =>
  [...document.querySelectorAll('.timeline__step')].map((li) => {
    const state = [...li.classList].find((c) => c.startsWith('timeline__step--')).split('--')[1];
    return `${li.querySelector('.timeline__label').textContent}:${state}`;
  });

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('employee list', () => {
  test('shows each employee with join date, phase, outcome and next review', async () => {
    fakeBackend({
      employees: [
        employee(1),
        employee(2, { phase: 'junior', track: 'staff', phases: JUNIOR_PHASES }),
        employee(3, { status: 'discontinued' }),
      ],
    });
    open('/employees');

    const first = (await screen.findByRole('link', { name: 'Sample Person 1' })).closest('tr');
    expect(within(first).getByText('TEST-001')).toBeTruthy();
    expect(within(first).getAllByText('02 Nov 2026')).toHaveLength(2);
    expect(within(first).getByText('Not set')).toBeTruthy();
    expect(within(first).getByText('Evaluation')).toBeTruthy();
    expect(within(first).getAllByText('08 Nov 2026')).toHaveLength(2);
    expect(within(first).getByText('Currently Working')).toBeTruthy();
    expect(
      within(first)
        .getByRole('link', { name: 'Lifecycle of Sample Person 1' })
        .getAttribute('href'),
    ).toBe('/employees/1/lifecycle');

    const junior = screen.getByRole('link', { name: 'Sample Person 2' }).closest('tr');
    expect(within(junior).getByText('Staff')).toBeTruthy();
    // The junior end date is not calculated while the 9-month rule is unconfirmed.
    expect(
      within(junior).getAllByText('Not calculated (mentor confirmation required)'),
    ).toHaveLength(2);

    const gone = screen.getByRole('link', { name: 'Sample Person 3' }).closest('tr');
    expect(within(gone).getByText('Discontinued')).toBeTruthy();

    expect(screen.getAllByRole('columnheader').map((th) => th.textContent)).toEqual([
      'Employee',
      'Candidate ID',
      'Join Date',
      'Track',
      'Current Phase',
      'Phase Start',
      'Phase End',
      'Outcome',
      'Next Review',
      'Actions',
    ]);
  });

  test('says so when there are no employees', async () => {
    fakeBackend();
    open('/employees');

    expect(await screen.findByText('No employees yet')).toBeTruthy();
  });

  test('shows a loading message while the request is running', async () => {
    fakeBackend({ hang: true });
    open('/employees');

    expect(await screen.findByText('Loading employees…')).toBeTruthy();
  });

  test('shows an error when the backend fails, and Try again recovers', async () => {
    fakeBackend({ employees: [employee(1)], listFails: 1 });
    open('/employees');

    expect(await screen.findByText('The employees could not be loaded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('link', { name: 'Sample Person 1' })).toBeTruthy();
  });

  test('the filters offer the guide values and are sent to the backend', async () => {
    const backend = fakeBackend({
      employees: [employee(1), employee(2, { phase: 'probation', phases: PROBATION_PHASES })],
    });
    open('/employees');
    await screen.findByRole('link', { name: 'Sample Person 1' });

    expect(optionsOf('Track')).toEqual(['All', 'Intern', 'Staff', 'Not set']);
    expect(optionsOf('Current Phase')).toEqual([
      'All',
      'Evaluation',
      'Probation',
      'Junior',
      'Senior',
    ]);
    expect(optionsOf('Outcome')).toEqual([
      'All',
      'Currently Working',
      'Discontinued',
      'Terminated',
    ]);

    fireEvent.change(screen.getByLabelText('Current Phase'), { target: { value: 'probation' } });
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Sample Person 1' })).toBeNull());
    expect(callsTo(backend, 'GET', '/api/employees').at(-1).query.phase).toBe('probation');
  });
});

describe('phase pages', () => {
  test('each phase page lists only active employees in that phase', async () => {
    const backend = fakeBackend({
      employees: [
        employee(1),
        employee(2, { phase: 'probation', phases: PROBATION_PHASES }),
        employee(3, { status: 'discontinued' }),
      ],
    });
    open('/employees/phase/evaluation');

    expect(await screen.findByRole('link', { name: 'Sample Person 1' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Sample Person 2' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Sample Person 3' })).toBeNull();
    expect(callsTo(backend, 'GET', '/api/employees')[0].query).toMatchObject({
      phase: 'evaluation',
      status: 'active',
    });
    expect(document.querySelector('[aria-current="step"]').textContent).toContain('Evaluation');
  });

  test('the exit page lists discontinued and terminated employees', async () => {
    fakeBackend({
      employees: [
        employee(1),
        employee(2, { status: 'discontinued' }),
        employee(3, { phase: 'senior', status: 'terminated' }),
      ],
    });
    open('/employees/phase/exits');

    expect(await screen.findByRole('link', { name: 'Sample Person 2' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sample Person 3' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Sample Person 1' })).toBeNull();
  });

  test('an empty phase page says so', async () => {
    fakeBackend({ employees: [employee(1)] });
    open('/employees/phase/senior');

    expect(await screen.findByText('No one is in senior now')).toBeTruthy();
  });
});

describe('employee details', () => {
  test('shows identity, employment, the open decision and the phase history', async () => {
    fakeBackend({ employees: [employee(2, { phase: 'probation', phases: PROBATION_PHASES })] });
    open('/employees/2');

    expect(await screen.findByText('Sample Person 2')).toBeTruthy();
    expect(value('Candidate ID')).toBe('TEST-002');
    expect(value('Position')).toBe('Sample Position');
    expect(value('Join Date')).toBe('02 Nov 2026');
    expect(value('Track')).toBe('Not set');
    expect(value('Current Phase')).toBe('Probation');
    expect(value('Phase Start')).toBe('09 Nov 2026');
    expect(value('Phase End')).toBe('08 Feb 2027');
    expect(value('Outcome')).toBe('Currently Working');
    expect(value('Next Review')).toBe('08 Feb 2027');

    expect(screen.getByRole('heading', { name: 'Probation decision' })).toBeTruthy();
    expect(optionsOf(/^Decision/)).toEqual(['Select…', 'Pass', 'Extend', 'Discontinue']);
    // Probation has passed only once a decision says so; termination is not offered yet.
    expect(screen.queryByRole('heading', { name: 'End employment (Terminated)' })).toBeNull();

    const history = screen.getByRole('table', { name: 'Phase history' });
    const rows = within(history).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.cells[0].textContent)).toEqual(['Evaluation', 'Probation']);
    expect(within(rows[0]).getByText('Pass')).toBeTruthy();
    expect(within(rows[0]).getByRole('link', { name: 'Open' }).getAttribute('href')).toBe(
      'https://example.test/review',
    );
    expect(within(rows[1]).getByText('Open')).toBeTruthy();
    expect(document.body.innerHTML).not.toMatch(/salary/i);
  });

  test('evaluation offers only Pass and Discontinue', async () => {
    fakeBackend({ employees: [employee(1)] });
    open('/employees/1');

    await screen.findByRole('heading', { name: 'Evaluation decision' });
    expect(optionsOf(/^Decision/)).toEqual(['Select…', 'Pass', 'Discontinue']);
  });

  test('records a pass and shows the next phase', async () => {
    const backend = fakeBackend({ employees: [employee(1)] });
    open('/employees/1');
    await screen.findByRole('heading', { name: 'Evaluation decision' });

    fireEvent.change(screen.getByLabelText(/^Decision/), { target: { value: 'pass' } });
    fireEvent.change(screen.getByLabelText('Review document link'), {
      target: { value: 'https://example.test/review' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));

    expect(await screen.findByText('Decision recorded. Current phase: Probation.')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Probation decision' })).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/employees/1/decision')[0].body).toEqual({
      result: 'pass',
      endDate: null,
      exitDate: null,
      reason: '',
      reviewDocUrl: 'https://example.test/review',
    });
  });

  test('discontinue asks for a reason and an exit date before sending', async () => {
    const backend = fakeBackend({ employees: [employee(1)] });
    open('/employees/1');
    await screen.findByRole('heading', { name: 'Evaluation decision' });

    fireEvent.change(screen.getByLabelText(/^Decision/), { target: { value: 'discontinue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));
    expect(await screen.findByText('A reason is required to discontinue.')).toBeTruthy();
    expect(screen.getByText('Exit date is required.')).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/employees/1/decision')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/^Exit date/), { target: { value: '2026-11-05' } });
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Sample reason' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));

    expect(
      await screen.findByText('Decision recorded. The employee is now Discontinued.'),
    ).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/employees/1/decision')[0].body).toMatchObject({
      result: 'discontinue',
      exitDate: '2026-11-05',
      reason: 'Sample reason',
    });
  });

  test('extend asks for the new end date and shows the one-month limit', async () => {
    fakeBackend({ employees: [employee(2, { phase: 'probation', phases: PROBATION_PHASES })] });
    open('/employees/2');
    await screen.findByRole('heading', { name: 'Probation decision' });

    fireEvent.change(screen.getByLabelText(/^Decision/), { target: { value: 'extend' } });
    const endDate = screen.getByLabelText(/^Extended end date/);
    expect(endDate.max).toBe('2027-03-08');
    expect(screen.getByText(/to 08 Mar 2027 at the latest/)).toBeTruthy();
  });

  test('a junior pass asks for the junior end date and says why it is not calculated', async () => {
    const backend = fakeBackend({
      employees: [employee(2, { phase: 'junior', phases: JUNIOR_PHASES })],
    });
    open('/employees/2');
    await screen.findByRole('heading', { name: 'Junior decision' });

    expect(screen.getByText('PENDING HR CONFIRMATION')).toBeTruthy();
    expect(value('Phase End')).toBe('Not calculated (mentor confirmation required)');
    fireEvent.change(screen.getByLabelText(/^Decision/), { target: { value: 'pass' } });
    expect(screen.getByText(/from the join date is waiting for mentor confirmation/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));

    expect(await screen.findByText('Junior end date is required.')).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/employees/2/decision')).toHaveLength(0);
  });

  test('shows a refusal from the backend next to the field', async () => {
    fakeBackend({
      employees: [employee(2, { phase: 'probation', phases: PROBATION_PHASES })],
      refuse: { endDate: 'Probation can be extended to 2027-03-08 at the latest.' },
    });
    open('/employees/2');
    await screen.findByRole('heading', { name: 'Probation decision' });

    fireEvent.change(screen.getByLabelText(/^Decision/), { target: { value: 'extend' } });
    fireEvent.change(screen.getByLabelText(/^Extended end date/), {
      target: { value: '2027-04-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Record decision' }));

    expect(
      await screen.findByText('Probation can be extended to 2027-03-08 at the latest.'),
    ).toBeTruthy();
    expect(screen.getByText('Some fields need correcting. Nothing was saved.')).toBeTruthy();
  });

  test('a junior can be terminated with a date and a reason', async () => {
    const backend = fakeBackend({
      employees: [employee(2, { phase: 'junior', phases: JUNIOR_PHASES })],
    });
    open('/employees/2');
    const form = (
      await screen.findByRole('heading', { name: 'End employment (Terminated)' })
    ).closest('form');

    fireEvent.click(within(form).getByRole('button', { name: 'Record termination' }));
    expect(await within(form).findByText('A reason is required.')).toBeTruthy();

    fireEvent.change(within(form).getByLabelText(/^Termination date/), {
      target: { value: '2027-05-01' },
    });
    fireEvent.change(within(form).getByLabelText(/^Termination reason/), {
      target: { value: 'Sample termination reason' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Record termination' }));

    expect(await screen.findByText('Termination recorded.')).toBeTruthy();
    expect(await screen.findByText('Sample exit reason')).toBeTruthy();
    expect(value('Outcome')).toBe('Terminated');
    expect(callsTo(backend, 'POST', '/api/employees/2/termination')[0].body).toEqual({
      exitDate: '2027-05-01',
      reason: 'Sample termination reason',
    });
  });

  test('a discontinued employee shows the exit and offers no decision', async () => {
    fakeBackend({ employees: [employee(3, { status: 'discontinued' })] });
    open('/employees/3');

    expect(await screen.findByText('Sample exit reason')).toBeTruthy();
    expect(value('Exit Date')).toBe('01 Dec 2026');
    expect(value('Next Review')).toBe('--');
    expect(screen.queryByRole('button', { name: 'Record decision' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Record termination' })).toBeNull();
  });

  test('says so when the employee does not exist', async () => {
    fakeBackend();
    open('/employees/999');

    expect(await screen.findByText('Employee not found')).toBeTruthy();
  });
});

describe('lifecycle timeline', () => {
  test('marks passed phases, the current phase and the phases still to come', async () => {
    fakeBackend({ employees: [employee(2, { phase: 'junior', phases: JUNIOR_PHASES })] });
    open('/employees/2/lifecycle');

    await screen.findByText(/Timeline — Sample Person 2/);
    expect(steps()).toEqual([
      'Joined:done',
      'Evaluation:done',
      'Probation:done',
      'Junior:current',
      'Senior:future',
    ]);
    expect(document.querySelector('[aria-current="step"]').textContent).toContain('Junior');
    // Only recorded dates are shown: the open junior phase has no end date.
    const rows = within(screen.getByRole('table', { name: 'Phase history' })).getAllByRole('row');
    expect(rows.at(-1).textContent).toContain('Not calculated (mentor confirmation required)');
  });

  test('marks the phase in which the employee left', async () => {
    fakeBackend({
      employees: [
        employee(2, {
          phase: 'probation',
          status: 'discontinued',
          phases: [
            PROBATION_PHASES[0],
            { ...PROBATION_PHASES[1], result: 'discontinue', resultReason: 'Sample reason' },
          ],
        }),
      ],
    });
    open('/employees/2/lifecycle');

    await screen.findByText(/Timeline — Sample Person 2/);
    expect(steps()).toEqual([
      'Joined:done',
      'Evaluation:done',
      'Probation:exited',
      'Junior:future',
      'Senior:future',
    ]);
    expect(screen.getByText('Sample reason')).toBeTruthy();
  });
});

describe('edit employee', () => {
  test('sets the track and returns to the details page', async () => {
    const backend = fakeBackend({ employees: [employee(1)] });
    open('/employees/1/edit');

    await waitFor(() => expect(screen.getByLabelText('Employee').value).toBe('Sample Person 1'));
    // The form appears one step before the page copies the saved track into it
    // (an effect). Flush that step first, or it can overwrite the change below.
    await act(async () => {});
    expect(optionsOf('Track')).toEqual(['Select…', 'Intern', 'Staff']);
    fireEvent.change(screen.getByLabelText('Track'), { target: { value: 'intern' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Track saved.')).toBeTruthy();
    expect(currentPath()).toBe('/employees/1');
    const patches = callsTo(backend, 'PATCH', '/api/employees/1');
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toEqual({ track: 'intern' });
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.jsx';
import { AuthContext } from '../src/auth/AuthContext.jsx';
import { fromOfficeInput, toOfficeInput } from '../src/utils/format.js';

// Every name and phone number in this file is made up.

const SIGNED_IN = {
  status: 'authenticated',
  user: {
    id: 1,
    email: 'test.user@example.test',
    fullName: 'Test User',
    role: { code: 'main_user', name: 'Main User' },
    permissions: ['candidates.view', 'interviews.manage'],
  },
  login: async () => ({ ok: true }),
  logout: async () => ({ ok: true }),
};

const STAGE_NAMES = {
  applied: 'Applied',
  phone_screened: 'Phone Screened',
  interview_scheduled: 'Interview Scheduled',
  rejected: 'Rejected',
};

function entry(id, phoneScreen = null, stage = 'applied', rejectReason = null, mailStatus = null) {
  return {
    candidate: {
      id,
      candidateCode: `TEST-${String(id).padStart(3, '0')}`,
      fullName: `Sample Person ${id}`,
      phone: `07100000${String(id).padStart(2, '0')}`,
      email: null,
      position: null,
      stage: { code: stage, name: STAGE_NAMES[stage] },
      mailStatus,
    },
    phoneScreen,
    rejectReason,
  };
}

const screenRecord = (id, overrides = {}) => ({
  id,
  called: true,
  response: null,
  result: null,
  review: null,
  interviewAt: null,
  updatedAt: '2026-10-13T06:00:00.000Z',
  updatedBy: 'Test User',
  ...overrides,
});

// A pretend backend that keeps phone interviews in memory and applies the
// same stage rules as the real one.
function fakeBackend({ entries = [], listFails = 0, hang = false, refuseResult = null } = {}) {
  const state = { entries: entries.map((e) => structuredClone(e)), calls: [], listFails };
  const json = (status, data) => ({ ok: status < 400, status, json: async () => data });

  function save(found, body) {
    if (refuseResult) {
      return json(422, {
        error: 'validation_failed',
        message: 'x',
        fields: { result: refuseResult },
      });
    }
    if (body.result === 'not_selected' && !body.rejectReason?.trim()) {
      return json(422, {
        error: 'validation_failed',
        message: 'x',
        fields: {
          rejectReason: 'A reason for rejection is required when the result is Not Selected.',
        },
      });
    }
    const created = !found.phoneScreen;
    found.phoneScreen = screenRecord(found.phoneScreen?.id ?? found.candidate.id + 500, {
      called: body.called,
      response: body.response ?? null,
      result: body.result,
      review: body.review || null,
      interviewAt: body.interviewAt ? new Date(body.interviewAt).toISOString() : null,
    });
    const stage =
      body.result === 'selected'
        ? body.interviewAt
          ? 'interview_scheduled'
          : 'phone_screened'
        : body.result === 'not_selected'
          ? 'rejected'
          : found.candidate.stage.code;
    found.candidate.stage = { code: stage, name: STAGE_NAMES[stage] };
    found.rejectReason = stage === 'rejected' ? body.rejectReason : null;
    return json(created ? 201 : 200, found);
  }

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

      if (path === '/phone-interviews' && method === 'GET') {
        if (hang) return new Promise(() => {});
        if (state.listFails > 0) {
          state.listFails -= 1;
          return json(500, { error: 'Internal server error' });
        }
        const { search, result } = Object.fromEntries(url.searchParams);
        let found = state.entries;
        if (search)
          found = found.filter((e) =>
            e.candidate.fullName.toLowerCase().includes(search.toLowerCase()),
          );
        if (result === 'pending') found = found.filter((e) => !e.phoneScreen?.result);
        else if (result) found = found.filter((e) => e.phoneScreen?.result === result);
        return json(200, {
          items: found.map(({ candidate, phoneScreen }) => ({ candidate, phoneScreen })),
          total: found.length,
          page: 1,
          pageSize: 20,
        });
      }

      const one = path.match(/^\/candidates\/(\d+)\/phone-interview$/);
      if (one) {
        const found = state.entries.find((e) => e.candidate.id === Number(one[1]));
        return found
          ? json(200, found)
          : json(404, { error: 'not_found', message: 'Candidate not found.' });
      }
      if (path === '/phone-interviews' && method === 'POST') {
        return save(
          state.entries.find((e) => e.candidate.id === body.candidateId),
          body,
        );
      }
      const patch = path.match(/^\/phone-interviews\/(\d+)$/);
      if (patch && method === 'PATCH') {
        return save(
          state.entries.find((e) => e.phoneScreen?.id === Number(patch[1])),
          body,
        );
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

const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }));
// The form appears one step before its starting values are filled in, so wait
// for that step too. Otherwise typing straight away can be overwritten.
const formReady = async () => {
  await screen.findByLabelText('Result');
  await act(async () => {});
};
const callsTo = (backend, method, path) =>
  backend.calls.filter((call) => call.method === method && call.path === path);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('office time conversion', () => {
  test('a date-time box always means Asia/Colombo time', () => {
    expect(fromOfficeInput('2026-11-02T10:00')).toBe('2026-11-02T10:00:00+05:30');
    expect(toOfficeInput('2026-11-02T04:30:00.000Z')).toBe('2026-11-02T10:00');
    expect(toOfficeInput(fromOfficeInput('2026-12-31T23:45'))).toBe('2026-12-31T23:45');
    expect(fromOfficeInput('')).toBeNull();
    expect(toOfficeInput(null)).toBe('');
  });
});

describe('phone interview list', () => {
  test('shows every candidate, with or without a phone interview', async () => {
    fakeBackend({
      entries: [
        entry(1),
        entry(
          2,
          screenRecord(52, {
            result: 'selected',
            interviewAt: '2026-11-02T04:30:00.000Z',
            review: 'Sample remark',
          }),
          'interview_scheduled',
        ),
        entry(3, screenRecord(53, { result: 'not_selected' }), 'rejected', 'Sample reason'),
      ],
    });
    open('/phone-interviews');

    const waiting = (await screen.findByText('Sample Person 1')).closest('tr');
    expect(within(waiting).getByText('0710000001')).toBeTruthy();
    expect(within(waiting).getByText('Not recorded')).toBeTruthy();
    expect(
      within(waiting)
        .getByRole('link', { name: 'Record phone interview of Sample Person 1' })
        .getAttribute('href'),
    ).toBe('/phone-interviews/1/edit');

    const selected = screen.getByText('Sample Person 2').closest('tr');
    expect(within(selected).getByText('Selected')).toBeTruthy();
    expect(within(selected).getByText('Yes')).toBeTruthy();
    expect(within(selected).getByText('Sample remark')).toBeTruthy();
    expect(within(selected).getByText('02 Nov 2026, 10:00')).toBeTruthy();
    expect(
      within(selected).getByRole('link', { name: 'Edit phone interview of Sample Person 2' }),
    ).toBeTruthy();

    expect(
      within(screen.getByText('Sample Person 3').closest('tr')).getByText('Not Selected'),
    ).toBeTruthy();
  });

  test('shows mail status from the email log: Not sent until a mail is logged', async () => {
    fakeBackend({
      entries: [
        entry(1, screenRecord(51, { result: 'selected' }), 'phone_screened'),
        entry(2, screenRecord(52, { result: 'selected' }), 'phone_screened', null, 'sent'),
        entry(3, screenRecord(53, { result: 'selected' }), 'phone_screened', null, 'failed'),
      ],
    });
    open('/phone-interviews');

    const none = (await screen.findByText('Sample Person 1')).closest('tr');
    expect(within(none).getByText('Not sent')).toBeTruthy();
    const sent = (await screen.findByText('Sample Person 2')).closest('tr');
    expect(within(sent).getByText('Sent')).toBeTruthy();
    const failed = (await screen.findByText('Sample Person 3')).closest('tr');
    expect(within(failed).getByText('Failed')).toBeTruthy();
  });

  test('says so when there are no candidates', async () => {
    fakeBackend();
    open('/phone-interviews');

    expect(await screen.findByText('No candidates yet')).toBeTruthy();
  });

  test('shows a loading message while the request is running', async () => {
    fakeBackend({ hang: true });
    open('/phone-interviews');

    expect(await screen.findByText('Loading phone interviews…')).toBeTruthy();
  });

  test('shows an error when the backend fails, and Try again recovers', async () => {
    fakeBackend({ entries: [entry(1)], listFails: 1 });
    open('/phone-interviews');

    expect(await screen.findByText('The phone interviews could not be loaded')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Sample Person 1')).toBeTruthy();
  });

  test('the result filter is sent to the backend', async () => {
    const backend = fakeBackend({
      entries: [entry(1), entry(2, screenRecord(52, { result: 'selected' }), 'phone_screened')],
    });
    open('/phone-interviews');
    await screen.findByText('Sample Person 1');

    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'selected' } });

    await waitFor(() => expect(screen.queryByText('Sample Person 1')).toBeNull());
    expect(screen.getByText('Sample Person 2')).toBeTruthy();
    expect(callsTo(backend, 'GET', '/api/phone-interviews').at(-1).query.result).toBe('selected');
  });

  test('offers only the confirmed results in the filter, plus "not recorded"', async () => {
    fakeBackend();
    open('/phone-interviews');
    await screen.findByText('No candidates yet');

    const options = [...screen.getByLabelText('Result').options].map(
      (option) => option.textContent,
    );
    expect(options).toEqual(['All', 'Selected', 'Not Selected', 'Not recorded yet']);
  });

  test('searching asks the backend', async () => {
    const backend = fakeBackend({ entries: [entry(1), entry(2)] });
    open('/phone-interviews');
    await screen.findByText('Sample Person 1');

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'person 2' } });

    await waitFor(() => expect(screen.queryByText('Sample Person 1')).toBeNull());
    expect(callsTo(backend, 'GET', '/api/phone-interviews').at(-1).query.search).toBe('person 2');
  });
});

describe('phone interview form', () => {
  test('keeps Remark and Review independently editable and leaves Review as an unsaved draft', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/phone-interviews/1/edit');
    await formReady();

    const remark = screen.getByLabelText('Remark');
    const review = screen.getByLabelText('Review');
    expect(remark.placeholder).toBe('Enter call remarks...');
    expect(review.placeholder).toBe('Enter HR review...');
    expect(review.disabled).toBe(false);
    expect(screen.getByText(/Draft only; not saved/)).toBeTruthy();

    fireEvent.change(remark, { target: { value: 'Fictional call note' } });
    fireEvent.change(review, { target: { value: 'Fictional HR assessment' } });
    expect(remark.value).toBe('Fictional call note');
    expect(review.value).toBe('Fictional HR assessment');

    save();
    await screen.findByText(/Phone interview saved/);
    const sent = callsTo(backend, 'POST', '/api/phone-interviews')[0].body;
    expect(sent.review).toBe('Fictional call note');
    expect(sent).not.toHaveProperty('reviewDraft');
  });

  test('shows who the candidate is and where they are in the pipeline', async () => {
    fakeBackend({ entries: [entry(1)] });
    open('/phone-interviews/1/edit');

    expect(await screen.findByText('Sample Person 1')).toBeTruthy();
    expect(screen.getByText('0710000001')).toBeTruthy();
    expect(screen.getByText('Applied')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'TEST-001' }).getAttribute('href')).toBe(
      '/candidates/1',
    );
  });

  test('offers Selected, Not Selected and Remark, and exactly the seven chosen Responses', async () => {
    fakeBackend({ entries: [entry(1)] });
    open('/phone-interviews/1/edit');
    await formReady();

    expect([...screen.getByLabelText('Result').options].map((o) => o.textContent)).toEqual([
      'Select…',
      'Selected',
      'Not Selected',
      'Remark',
    ]);

    const response = screen.getByLabelText('Response');
    expect(response.disabled).toBe(false);
    expect([...response.options].map((o) => o.textContent)).toEqual([
      'Select…',
      'Interested',
      'Not Interested',
      'Call Back Later',
      'No Answer',
      'Busy',
      'Not Reachable',
      'Wrong Number',
    ]);
    expect(screen.queryByText('Not defined yet')).toBeNull();
    expect(screen.queryByText('Allowed values are not confirmed yet.')).toBeNull();
  });

  test('mail status is a four-option editable draft and is not submitted to the API', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/phone-interviews/1/edit');
    await formReady();

    const mail = await screen.findByLabelText('Mail Status');
    expect(mail.tagName).toBe('SELECT');
    expect(mail.disabled).toBe(false);
    expect(mail.value).toBe('not_sent');
    expect([...mail.options].map((option) => option.textContent)).toEqual([
      'Not sent',
      'Pending',
      'Sent',
      'Failed',
    ]);
    for (const [value, label] of [
      ['queued', 'Pending'],
      ['sent', 'Sent'],
      ['failed', 'Failed'],
      ['not_sent', 'Not sent'],
    ]) {
      fireEvent.change(mail, { target: { value } });
      expect(mail.selectedOptions[0].textContent).toBe(label);
    }
    expect(screen.getByText(/Mail Status is read from email_log/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Called'), { target: { checked: true } });
    save();
    await screen.findByText(/Phone interview saved/);
    const body = callsTo(backend, 'POST', '/api/phone-interviews')[0].body;
    expect(body).not.toHaveProperty('mailStatus');
  });

  test('a development-mode email initializes as Not sent because it was not delivered', async () => {
    fakeBackend({ entries: [entry(1, null, 'applied', null, 'simulated')] });
    open('/phone-interviews/1/edit');

    const mail = await screen.findByLabelText('Mail Status');
    expect(mail.tagName).toBe('SELECT');
    expect(mail.value).toBe('not_sent');
  });

  test('the interview date is available only when the result is Selected', async () => {
    fakeBackend({ entries: [entry(1)] });
    open('/phone-interviews/1/edit');
    // Wait for the form's starting values to be filled in as well; changing a
    // control before that step can be overwritten by it.
    await formReady();
    const date = screen.getByLabelText('Interview Date/Time');

    expect(date.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'selected' } });
    expect(date.disabled).toBe(false);

    fireEvent.change(date, { target: { value: '2026-11-02T10:00' } });
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'not_selected' } });
    expect(date.disabled).toBe(true);
    expect(date.value).toBe('');
  });

  test('the Result dropdown offers Select…, Selected, Not Selected and Remark', async () => {
    fakeBackend({ entries: [entry(1)] });
    open('/phone-interviews/1/edit');
    await formReady();

    const options = [...screen.getByLabelText('Result').options].map((o) => [o.value, o.text]);
    expect(options).toEqual([
      ['', 'Select…'],
      ['selected', 'Selected'],
      ['not_selected', 'Not Selected'],
      ['remark', 'Remark'],
    ]);
    // No explanation is shown under the field.
    expect(screen.queryByText(/moves the candidate to/)).toBeNull();
    expect(screen.queryByText(/Remark only records/)).toBeNull();
  });

  test('Remark and Review follow Result: Remark is optional by default and required for Not Selected', async () => {
    fakeBackend({ entries: [entry(1)] });
    open('/phone-interviews/1/edit');
    await formReady();

    const remark = screen.getByLabelText('Remark');
    expect(remark.required).toBe(false);
    const order = (a, b) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(order(screen.getByLabelText('Result'), remark)).toBe(true);
    expect(order(remark, screen.getByLabelText('Review'))).toBe(true);
    expect(order(remark, screen.getByLabelText('Interview Date/Time'))).toBe(true);

    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'selected' } });
    expect(screen.getByLabelText('Remark').required).toBe(false);
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'not_selected' } });
    expect(screen.getByLabelText(/^Remark/).required).toBe(true);
    expect(screen.queryByLabelText(/^Reason for rejection/)).toBeNull();
    expect(screen.getByLabelText('Review').disabled).toBe(false);
  });

  test('Not Selected without a remark is stopped before anything is sent', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/phone-interviews/1/edit');
    await formReady();

    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'not_selected' } });
    save();

    expect(
      await screen.findByText('A remark is required when the result is Not Selected.'),
    ).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/phone-interviews')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/^Remark/), { target: { value: '   ' } });
    save();
    expect(
      await screen.findByText('A remark is required when the result is Not Selected.'),
    ).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/phone-interviews')).toHaveLength(0);
  });

  test('Not Selected with a remark rejects the candidate; the remark is kept as the call remark and the reason', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/phone-interviews/1/edit');
    await formReady();

    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'not_selected' } });
    fireEvent.change(screen.getByLabelText(/^Remark/), {
      target: { value: 'Not a fit for the role' },
    });
    save();

    expect(
      await screen.findByText('Phone interview saved. Current status: Rejected.'),
    ).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/phone-interviews')[0].body).toMatchObject({
      result: 'not_selected',
      review: 'Not a fit for the role',
      rejectReason: 'Not a fit for the role',
    });
  });

  test('Selected needs no remark; no rejection reason is sent', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/phone-interviews/1/edit');
    await formReady();

    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'selected' } });
    save();
    expect(
      await screen.findByText('Phone interview saved. Current status: Phone Screened.'),
    ).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/phone-interviews')[0].body).toMatchObject({
      result: 'selected',
      review: '',
      rejectReason: '',
    });
  });

  test('choosing Remark shows an editable remark field that is required', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/phone-interviews/1/edit');
    await formReady();

    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'remark' } });
    const remark = screen.getByLabelText(/^Remark/);
    expect(remark.required).toBe(true);
    expect(remark.disabled).toBe(false);
    expect(screen.getByLabelText('Interview Date/Time').disabled).toBe(true);

    save();
    expect(await screen.findByText('A remark is required when the result is Remark.')).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/phone-interviews')).toHaveLength(0);

    fireEvent.change(remark, { target: { value: '   ' } });
    save();
    expect(await screen.findByText('A remark is required when the result is Remark.')).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/phone-interviews')).toHaveLength(0);
  });

  test('a Remark saves the remark only: no result, no rejection reason, the stage stays', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/phone-interviews/1/edit');
    await formReady();

    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'remark' } });
    fireEvent.change(screen.getByLabelText(/^Remark/), {
      target: { value: 'Asked to call again next week' },
    });
    save();

    expect(await screen.findByText('Phone interview saved. Current status: Applied.')).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/phone-interviews')[0].body).toMatchObject({
      result: null,
      interviewAt: null,
      rejectReason: '',
      review: 'Asked to call again next week',
    });
    expect(await screen.findByText('Asked to call again next week')).toBeTruthy();
  });

  test('editing shows a saved remark again, as the Remark choice', async () => {
    fakeBackend({
      entries: [entry(1, screenRecord(51, { review: 'Asked to call again next week' }))],
    });
    open('/phone-interviews/1/edit');

    await waitFor(() => expect(screen.getByLabelText('Result').value).toBe('remark'));
    expect(screen.getByLabelText(/^Remark/).value).toBe('Asked to call again next week');
    expect(screen.getByLabelText(/^Remark/).required).toBe(true);
  });

  test('a changed Remark is saved on an existing record without touching its stage', async () => {
    const backend = fakeBackend({
      entries: [entry(1, screenRecord(51, { review: 'First note' }))],
    });
    open('/phone-interviews/1/edit');
    await waitFor(() => expect(screen.getByLabelText(/^Remark/).value).toBe('First note'));

    fireEvent.change(screen.getByLabelText(/^Remark/), { target: { value: 'Second note' } });
    save();

    expect(await screen.findByText('Phone interview saved. Current status: Applied.')).toBeTruthy();
    expect(callsTo(backend, 'PATCH', '/api/phone-interviews/51')[0].body).toMatchObject({
      result: null,
      review: 'Second note',
    });
  });

  test('Remark on a candidate who is already Selected keeps the selection and the stage', async () => {
    const backend = fakeBackend({
      entries: [
        entry(
          1,
          screenRecord(51, {
            result: 'selected',
            interviewAt: '2026-11-02T04:30:00.000Z',
            review: 'Earlier remark',
          }),
          'interview_scheduled',
        ),
      ],
    });
    open('/phone-interviews/1/edit');
    await waitFor(() => expect(screen.getByLabelText('Result').value).toBe('selected'));

    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'remark' } });
    fireEvent.change(screen.getByLabelText(/^Remark/), { target: { value: 'Confirmed by phone' } });
    save();

    expect(
      await screen.findByText('Phone interview saved. Current status: Interview Scheduled.'),
    ).toBeTruthy();
    expect(callsTo(backend, 'PATCH', '/api/phone-interviews/51')[0].body).toMatchObject({
      result: 'selected',
      interviewAt: '2026-11-02T04:30:00.000Z',
      review: 'Confirmed by phone',
    });
  });

  test('Remark on a candidate who is already Not Selected keeps the rejection and its reason', async () => {
    const backend = fakeBackend({
      entries: [
        entry(
          1,
          screenRecord(51, { result: 'not_selected', review: 'Call went badly' }),
          'rejected',
          'Earlier reason',
        ),
      ],
    });
    open('/phone-interviews/1/edit');
    await waitFor(() => expect(screen.getByLabelText('Result').value).toBe('not_selected'));

    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'remark' } });
    fireEvent.change(screen.getByLabelText(/^Remark/), {
      target: { value: 'Called back, same view' },
    });
    save();

    expect(
      await screen.findByText('Phone interview saved. Current status: Rejected.'),
    ).toBeTruthy();
    expect(callsTo(backend, 'PATCH', '/api/phone-interviews/51')[0].body).toMatchObject({
      result: 'not_selected',
      rejectReason: 'Earlier reason',
      review: 'Called back, same view',
    });
  });

  test('Select… applies no result and no stage change, whatever the remark says', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/phone-interviews/1/edit');
    await formReady();

    fireEvent.change(screen.getByLabelText('Remark'), { target: { value: 'Will call back' } });
    save();
    expect(await screen.findByText('Phone interview saved. Current status: Applied.')).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/phone-interviews')[0].body).toMatchObject({
      result: null,
      review: 'Will call back',
      rejectReason: '',
    });
  });

  test('a remark over 500 characters is refused for Not Selected, where it is also the reason', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/phone-interviews/1/edit');
    await formReady();

    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'not_selected' } });
    fireEvent.change(screen.getByLabelText(/^Remark/), { target: { value: 'x'.repeat(501) } });
    save();
    expect(
      await screen.findByText('For Not Selected the remark must be at most 500 characters.'),
    ).toBeTruthy();
    expect(callsTo(backend, 'POST', '/api/phone-interviews')).toHaveLength(0);
  });

  test('records a new phone interview and shows the new status', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/phone-interviews/1/edit');
    await formReady();

    fireEvent.click(screen.getByLabelText('Called'));
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'selected' } });
    fireEvent.change(screen.getByLabelText('Interview Date/Time'), {
      target: { value: '2026-11-02T10:00' },
    });
    fireEvent.change(screen.getByLabelText('Remark'), {
      target: { value: 'Sample remark about the call' },
    });
    save();

    expect(
      await screen.findByText('Phone interview saved. Current status: Interview Scheduled.'),
    ).toBeTruthy();
    expect(currentPath()).toBe('/phone-interviews/1');
    expect(await screen.findByText('Sample remark about the call')).toBeTruthy();
    expect(screen.getByText('02 Nov 2026, 10:00')).toBeTruthy();

    expect(callsTo(backend, 'POST', '/api/phone-interviews')[0].body).toEqual({
      candidateId: 1,
      called: true,
      response: null,
      result: 'selected',
      interviewAt: '2026-11-02T10:00:00+05:30',
      rejectReason: '',
      review: 'Sample remark about the call',
    });
  });

  test('a chosen Response is sent with the save and shown again when reopened', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/phone-interviews/1/edit');
    await formReady();

    fireEvent.click(screen.getByLabelText('Called'));
    fireEvent.change(screen.getByLabelText('Response'), { target: { value: 'Call Back Later' } });
    save();

    expect(await screen.findByText('Phone interview saved. Current status: Applied.')).toBeTruthy();
    const sent = callsTo(backend, 'POST', '/api/phone-interviews')[0].body;
    expect(sent.response).toBe('Call Back Later');
    expect(sent.result).toBeNull();
    expect(await screen.findByText('Call Back Later')).toBeTruthy();
  });

  test('an existing Response is loaded into the dropdown', async () => {
    fakeBackend({ entries: [entry(1, screenRecord(51, { response: 'Busy' }))] });
    open('/phone-interviews/1/edit');
    await waitFor(() => expect(screen.getByLabelText('Response').value).toBe('Busy'));
  });

  test('saving a call with no result yet sends no result', async () => {
    const backend = fakeBackend({ entries: [entry(1)] });
    open('/phone-interviews/1/edit');
    await formReady();

    fireEvent.click(screen.getByLabelText('Called'));
    save();

    expect(await screen.findByText('Phone interview saved. Current status: Applied.')).toBeTruthy();
    const sent = callsTo(backend, 'POST', '/api/phone-interviews')[0].body;
    expect(sent.result).toBeNull();
    expect(sent.interviewAt).toBeNull();
  });

  test('loads an existing phone interview and saves the change', async () => {
    const backend = fakeBackend({
      entries: [
        entry(
          1,
          screenRecord(51, {
            result: 'selected',
            interviewAt: '2026-11-02T04:30:00.000Z',
            review: 'Earlier remark',
          }),
          'interview_scheduled',
        ),
      ],
    });
    open('/phone-interviews/1/edit');

    await waitFor(() => expect(screen.getByLabelText('Result').value).toBe('selected'));
    expect(screen.getByLabelText('Called').checked).toBe(true);
    expect(screen.getByLabelText('Interview Date/Time').value).toBe('2026-11-02T10:00');
    expect(screen.getByLabelText('Remark').value).toBe('Earlier remark');

    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'not_selected' } });
    fireEvent.change(screen.getByLabelText(/^Remark/), {
      target: { value: 'Sample reason' },
    });
    save();

    expect(
      await screen.findByText('Phone interview saved. Current status: Rejected.'),
    ).toBeTruthy();
    const sent = callsTo(backend, 'PATCH', '/api/phone-interviews/51')[0].body;
    expect(sent).toMatchObject({
      result: 'not_selected',
      interviewAt: null,
      rejectReason: 'Sample reason',
    });
    expect(callsTo(backend, 'POST', '/api/phone-interviews')).toHaveLength(0);
  });

  test('an existing rejection reason with no remark shows in the Remark field', async () => {
    fakeBackend({
      entries: [
        entry(1, screenRecord(51, { result: 'not_selected' }), 'rejected', 'Earlier reason'),
      ],
    });
    open('/phone-interviews/1/edit');

    await waitFor(() => expect(screen.getByLabelText(/^Remark/).value).toBe('Earlier reason'));
  });

  test('an earlier, different rejection reason is not overwritten when the remark is untouched', async () => {
    const backend = fakeBackend({
      entries: [
        entry(
          1,
          screenRecord(51, { result: 'not_selected', review: 'Call went badly' }),
          'rejected',
          'Earlier reason',
        ),
      ],
    });
    open('/phone-interviews/1/edit');
    await waitFor(() => expect(screen.getByLabelText(/^Remark/).value).toBe('Call went badly'));
    fireEvent.click(screen.getByLabelText('Called'));
    save();
    await screen.findByText(/Phone interview saved/);
    expect(callsTo(backend, 'PATCH', '/api/phone-interviews/51')[0].body).toMatchObject({
      review: 'Call went badly',
      rejectReason: 'Earlier reason',
    });
  });

  test('shows a refusal from the backend next to the field, and saves nothing', async () => {
    const message =
      'This candidate has already moved on to "Interviewed", so the phone interview result can no longer be changed.';
    fakeBackend({
      entries: [entry(1, screenRecord(51, { result: 'selected' }), 'phone_screened')],
      refuseResult: message,
    });
    open('/phone-interviews/1/edit');
    await waitFor(() => expect(screen.getByLabelText('Result').value).toBe('selected'));

    fireEvent.change(screen.getByLabelText('Result'), { target: { value: '' } });
    save();

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.getByText('Some fields need correcting. Nothing was saved.')).toBeTruthy();
    expect(currentPath()).toBe('/phone-interviews/1/edit');
  });

  test('says so when the candidate does not exist', async () => {
    fakeBackend();
    open('/phone-interviews/999/edit');

    expect(await screen.findByText('Candidate not found')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });
});

describe('phone interview details', () => {
  test('shows the candidate, the result, the slot, the review and the current status', async () => {
    fakeBackend({
      entries: [
        entry(
          1,
          screenRecord(51, {
            result: 'selected',
            interviewAt: '2026-11-02T04:30:00.000Z',
            review: 'Sample remark',
          }),
          'interview_scheduled',
        ),
      ],
    });
    open('/phone-interviews/1');

    expect(await screen.findByText('Sample Person 1')).toBeTruthy();
    expect(screen.getByText('Interview Scheduled')).toBeTruthy();
    expect(screen.getByText('Selected')).toBeTruthy();
    expect(screen.getByText('02 Nov 2026, 10:00')).toBeTruthy();
    expect(screen.getByText('Sample remark')).toBeTruthy();
    expect(screen.getByText('Not sent')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Edit phone interview' }).getAttribute('href')).toBe(
      '/phone-interviews/1/edit',
    );
  });

  test('shows the rejection reason of a rejected candidate', async () => {
    fakeBackend({
      entries: [
        entry(
          1,
          screenRecord(51, { result: 'not_selected' }),
          'rejected',
          'Sample rejection reason',
        ),
      ],
    });
    open('/phone-interviews/1');

    expect(await screen.findByText('Sample rejection reason')).toBeTruthy();
    expect(screen.getByText('Rejected')).toBeTruthy();
    expect(screen.getByText('Not Selected')).toBeTruthy();
  });

  test('offers to record one when none exists yet', async () => {
    fakeBackend({ entries: [entry(1)] });
    open('/phone-interviews/1');

    expect(await screen.findByText('No phone interview has been recorded yet')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Record phone interview' }).getAttribute('href')).toBe(
      '/phone-interviews/1/edit',
    );
  });

  test('says so when the candidate does not exist', async () => {
    fakeBackend();
    open('/phone-interviews/999');

    expect(await screen.findByText('Candidate not found')).toBeTruthy();
  });
});

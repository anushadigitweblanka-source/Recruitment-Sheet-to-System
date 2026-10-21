// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.jsx';
import { AuthContext } from '../src/auth/AuthContext.jsx';

// Reading a CV into the Add Candidate form, and registering from it. The
// backend is a pretend one; every name, phone and email is made up.

const SIGNED_IN = {
  status: 'authenticated',
  user: {
    id: 1,
    email: 'test.user@example.test',
    fullName: 'Test User',
    role: { code: 'hr', name: 'HR' },
    permissions: ['candidates.view', 'candidates.edit'],
  },
  login: async () => ({ ok: true }),
  logout: async () => ({ ok: true }),
};

const FULL_DRAFT = {
  fullName: 'Nimali Testperson',
  phone: '0700000001',
  email: 'nimali.testperson@example.test',
  address: '12 Fictional Lane, Examplepura',
  olMaths: 'A',
  alResult: '3 passes',
  alStream: 'Physical Science',
};

const extractionOf = (draft, overrides = {}) => ({
  extraction: {
    status: 'extracted',
    formDraft: draft,
    fields: {},
    review: {
      extracted: Object.keys(draft),
      uncertain: [],
      unavailable: ['otherEducation'],
    },
    warnings: [],
    ...overrides,
  },
  duplicates: [],
  registration: { candidateIdRequired: true },
  cvUrl: null,
});

function fakeBackend({ extract = extractionOf(FULL_DRAFT), extractError = null, save } = {}) {
  const state = { candidates: [], calls: [], extract, extractError };
  const json = (status, data) => ({ ok: status < 400, status, json: async () => data });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (address, options = {}) => {
      const url = new URL(address, 'http://test.local');
      const path = url.pathname.replace('/api', '');
      const method = options.method ?? 'GET';
      state.calls.push({ path, method, body: options.body });

      if (path === '/lookups/positions' || path === '/lookups/sources') {
        return json(200, { items: [] });
      }
      if (path === '/lookups/stages') return json(200, { items: [] });
      if (path === '/candidates/extract-cv/file' || path === '/candidates/extract-cv/link') {
        if (state.extractError) return json(state.extractError.status, state.extractError.body);
        const body = state.extract;
        return json(
          200,
          path.endsWith('/link') ? { ...body, cvUrl: 'https://cv.example.test/a.pdf' } : body,
        );
      }
      if (path === '/candidates' && method === 'POST') {
        if (save) return save(JSON.parse(options.body), state, json);
        const data = JSON.parse(options.body);
        const candidate = {
          id: 900 + state.candidates.length,
          stage: { code: 'applied' },
          ...data,
        };
        state.candidates.push(candidate);
        return json(201, { candidate });
      }
      if (path === '/candidates' && method === 'GET') {
        return json(200, {
          items: state.candidates,
          total: state.candidates.length,
          page: 1,
          pageSize: 20,
        });
      }
      if (path === '/recruitment-records') {
        return json(200, { items: [], total: 0, page: 1, pageSize: 20 });
      }
      return json(404, { error: 'Not found' });
    }),
  );
  return state;
}

function open(path = '/candidates/new', auth = SIGNED_IN) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const pdf = (name = 'cv.pdf') => new File(['%PDF-1.4 made-up'], name, { type: 'application/pdf' });
const upload = (file) =>
  fireEvent.change(screen.getByLabelText('Upload CV'), { target: { files: [file] } });
const value = (label) => screen.getByLabelText(label).value;
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const posts = (backend) =>
  backend.calls.filter((c) => c.method === 'POST' && c.path === '/candidates');

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('reading a CV into the form', () => {
  test('an uploaded PDF fills the form, keeps the phone as text and leaves the ID to HR', async () => {
    const backend = fakeBackend();
    open();
    await screen.findByLabelText('Upload CV');
    upload(pdf());

    await screen.findByText(/CV read\. Please check/);
    expect(value(/^Name/)).toBe('Nimali Testperson');
    expect(value('Phone')).toBe('0700000001');
    expect(value('Email')).toBe('nimali.testperson@example.test');
    expect(value('O/L Maths')).toBe('A');
    expect(value(/^Candidate ID/)).toBe('');
    expect(screen.getByText(/Not found in the CV:/).closest('p').textContent).toContain(
      'Other Education',
    );

    const sent = backend.calls.find((c) => c.path === '/candidates/extract-cv/file');
    expect(sent.method).toBe('POST');
    expect(posts(backend)).toHaveLength(0); // reading saves nothing
  });

  test('a CV link is read and offered as the CV Link', async () => {
    const backend = fakeBackend();
    open();
    fireEvent.change(await screen.findByLabelText('CV link'), {
      target: { value: 'https://cv.example.test/a.pdf' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Read link' }));

    await screen.findByText(/CV read\. Please check/);
    expect(value('CV Link')).toBe('https://cv.example.test/a.pdf');
    const sent = backend.calls.find((c) => c.path === '/candidates/extract-cv/link');
    expect(JSON.parse(sent.body)).toEqual({ url: 'https://cv.example.test/a.pdf' });
  });

  test('a link that cannot be read shows the reason and fills nothing', async () => {
    fakeBackend({
      extractError: {
        status: 422,
        body: {
          error: 'link_refused',
          message: 'The link needs a sign-in, which is not supported.',
        },
      },
    });
    open();
    fireEvent.change(await screen.findByLabelText('CV link'), {
      target: { value: 'https://private.example.test/cv.pdf' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Read link' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('needs a sign-in');
    expect(alert.textContent).toContain('Nothing was filled in or saved');
    expect(value(/^Name/)).toBe('');
  });

  test('a file that is not a PDF or Word file is refused before it is sent', async () => {
    const backend = fakeBackend();
    open();
    await screen.findByLabelText('Upload CV');
    upload(new File(['hello'], 'notes.txt', { type: 'text/plain' }));

    expect((await screen.findByRole('alert')).textContent).toContain('PDF or Word');
    expect(backend.calls.some((c) => c.path.startsWith('/candidates/extract-cv'))).toBe(false);
  });

  test('a Word file without a reported type is recognised by its extension', async () => {
    const backend = fakeBackend();
    open();
    await screen.findByLabelText('Upload CV');
    upload(new File(['PK made-up'], 'cv.docx', { type: '' }));
    await screen.findByText(/CV read\. Please check/);
    expect(backend.calls.some((c) => c.path === '/candidates/extract-cv/file')).toBe(true);
  });

  test('uncertain and missing fields are listed for review and are not filled in', async () => {
    fakeBackend({
      extract: extractionOf(
        { email: 'a@example.test' },
        {
          fields: {
            phone: {
              status: 'uncertain',
              value: '0700000002',
              note: 'More than one phone number was found. Confirm which to use.',
              alternatives: ['0700000002', '0700000003'],
            },
          },
          review: { extracted: ['email'], uncertain: ['phone'], unavailable: ['address'] },
        },
      ),
    });
    open();
    await screen.findByLabelText('Upload CV');
    upload(pdf());
    await screen.findByText(/Please confirm/);

    expect(value('Phone')).toBe(''); // not pre-filled
    fireEvent.click(screen.getByRole('button', { name: 'Use 0700000003' }));
    expect(value('Phone')).toBe('0700000003');
  });

  test('values already typed are not overwritten by the CV', async () => {
    fakeBackend();
    open();
    fireEvent.change(await screen.findByLabelText(/^Name/), { target: { value: 'Typed Name' } });
    upload(pdf());
    await screen.findByText(/CV read\. Please check/);
    expect(value(/^Name/)).toBe('Typed Name');
    expect(value('Email')).toBe('nimali.testperson@example.test');
  });

  test('a possible existing candidate is shown with a link to open them', async () => {
    fakeBackend({
      extract: {
        ...extractionOf(FULL_DRAFT),
        duplicates: [
          { id: 7, candidateCode: 'OLD-007', fullName: 'Nimali Testperson', matchedOn: ['phone'] },
        ],
      },
    });
    open();
    await screen.findByLabelText('Upload CV');
    upload(pdf());

    const warning = await screen.findByText('This person may already be a candidate');
    const link = within(warning.closest('.notice')).getByRole('link', { name: /OLD-007/ });
    expect(link.getAttribute('href')).toBe('/candidates/7');
  });
});

describe('registering from the CV details', () => {
  async function filled(backendOptions) {
    const backend = fakeBackend(backendOptions);
    open();
    await screen.findByLabelText('Upload CV');
    upload(pdf());
    await screen.findByText(/CV read\. Please check/);
    return backend;
  }

  test('Candidate ID is required: without it nothing is sent', async () => {
    const backend = await filled();
    fireEvent.click(saveButton());
    expect(await screen.findByText('Candidate ID is required.')).toBeTruthy();
    expect(posts(backend)).toHaveLength(0);
  });

  test('after the backend confirms the save, the Candidate ID and links are shown', async () => {
    const backend = await filled();
    fireEvent.change(screen.getByLabelText(/^Candidate ID/), { target: { value: 'CVX-0001' } });
    fireEvent.click(saveButton());

    const notice = await screen.findByText('Candidate registered');
    const box = notice.closest('.notice');
    expect(box.textContent).toContain('CVX-0001');
    expect(within(box).getByRole('link', { name: 'View Candidate' }).getAttribute('href')).toBe(
      '/candidates/900',
    );
    expect(within(box).getByRole('link', { name: 'Candidate List' }).getAttribute('href')).toBe(
      '/candidates',
    );
    const [sent] = posts(backend);
    expect(JSON.parse(sent.body)).toMatchObject({
      candidateCode: 'CVX-0001',
      phone: '0700000001',
      fullName: 'Nimali Testperson',
    });
  });

  test('success is not shown until the backend answers', async () => {
    let answer;
    await filled({
      save: (data, state, json) =>
        new Promise((resolve) => {
          answer = () => {
            state.candidates.push({ id: 901, ...data });
            resolve(json(201, { candidate: { id: 901, ...data } }));
          };
        }),
    });
    fireEvent.change(screen.getByLabelText(/^Candidate ID/), { target: { value: 'CVX-0002' } });
    fireEvent.click(saveButton());

    await screen.findByRole('button', { name: 'Saving…' });
    expect(screen.queryByText('Candidate registered')).toBeNull();
    answer();
    expect(await screen.findByText('Candidate registered')).toBeTruthy();
  });

  test('a double click sends the save only once', async () => {
    const backend = await filled();
    fireEvent.change(screen.getByLabelText(/^Candidate ID/), { target: { value: 'CVX-0003' } });
    const button = saveButton();
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByText('Candidate registered');
    expect(posts(backend)).toHaveLength(1);
  });

  test('the existing duplicate warning is kept: no success, and no automatic override', async () => {
    const backend = await filled({
      save: (data, state, json) =>
        data.confirmDuplicate
          ? json(201, { candidate: { id: 950, ...data } })
          : json(409, {
              error: 'possible_duplicate',
              duplicates: [
                {
                  id: 7,
                  candidateCode: 'OLD-007',
                  fullName: 'Nimali Testperson',
                  matchedOn: ['phone'],
                  phone: null,
                  email: null,
                  position: null,
                },
              ],
            }),
    });
    fireEvent.change(screen.getByLabelText(/^Candidate ID/), { target: { value: 'CVX-0004' } });
    fireEvent.click(saveButton());

    await screen.findByText('This may be a duplicate. Nothing has been saved yet.');
    expect(screen.queryByText('Candidate registered')).toBeNull();
    expect(posts(backend)).toHaveLength(1);
    expect(JSON.parse(posts(backend)[0].body).confirmDuplicate).toBe(false);

    // Only HR's own click on the explicit button saves it as a separate person.
    fireEvent.click(screen.getByRole('button', { name: 'Save as a separate candidate' }));
    await screen.findByText('Candidate registered');
    expect(JSON.parse(posts(backend)[1].body).confirmDuplicate).toBe(true);
  });

  test('a rejected save shows the problem and never claims success', async () => {
    await filled({
      save: (data, state, json) =>
        json(422, {
          error: 'validation_failed',
          fields: { candidateCode: 'This Candidate ID is already used by another candidate.' },
        }),
    });
    fireEvent.change(screen.getByLabelText(/^Candidate ID/), { target: { value: 'CVX-0005' } });
    fireEvent.click(saveButton());

    expect(await screen.findByText(/already used by another candidate/)).toBeTruthy();
    expect(screen.queryByText('Candidate registered')).toBeNull();
  });

  test('the Candidate List shows the new candidate without a page reload', async () => {
    await filled();
    fireEvent.change(screen.getByLabelText(/^Candidate ID/), { target: { value: 'CVX-0006' } });
    fireEvent.click(saveButton());
    await screen.findByText('Candidate registered');

    const box = screen.getByText('Candidate registered').closest('.notice');
    fireEvent.click(within(box).getByRole('link', { name: 'Candidate List' }));
    expect(await screen.findByText('CVX-0006')).toBeTruthy();
  });
});

describe('permissions', () => {
  test('a user who cannot edit candidates gets no CV reader', async () => {
    fakeBackend();
    open('/candidates/new', {
      ...SIGNED_IN,
      user: { ...SIGNED_IN.user, permissions: ['candidates.view'] },
    });
    await screen.findByText('You do not have permission to add or edit candidates');
    expect(screen.queryByLabelText('Upload CV')).toBeNull();
  });

  test('editing an existing candidate offers no CV reader, so no record is overwritten', async () => {
    fakeBackend();
    open('/candidates/5/edit');
    await waitFor(() => expect(screen.queryByLabelText('Upload CV')).toBeNull());
  });
});

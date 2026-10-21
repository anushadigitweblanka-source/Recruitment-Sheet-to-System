// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, test, vi } from 'vitest';
import App from '../src/App.jsx';
import { AuthContext } from '../src/auth/AuthContext.jsx';
import { fillFields, matchLookup } from '../src/modules/candidates/cvFill.js';

// Reading a CV into the Add Candidate form. The backend is a pretend one that
// answers like the real extraction route; every name, phone and email is made
// up, and nothing here touches a database.

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

const POSITIONS = [
  { id: 7, name: 'QA Intern', isActive: true },
  { id: 8, name: 'Retired Role', isActive: false },
];
const SOURCES = [
  { id: 3, name: 'LinkedIn', isActive: true },
  { id: 4, name: 'Referral', isActive: true },
];

const FULL_DRAFT = {
  fullName: 'ANUSHA PERERA',
  phone: '0771234567',
  email: 'anusha.perera@example.test',
  address: '12 Fictional Lane, Examplepura',
  olMaths: 'A',
  alResult: '3 passes',
  alStream: 'Physical Science',
  otherEducation: 'BSc in Imaginary Computing, Fictional University',
};

const answer = (draft = FULL_DRAFT, extra = {}) => ({
  extraction: {
    status: 'extracted',
    formDraft: draft,
    fields: {},
    hints: { appliedPosition: null, source: null },
    review: { extracted: Object.keys(draft), uncertain: [], unavailable: [] },
    warnings: [],
    ...extra,
  },
  duplicates: [],
  cvUrl: null,
});

function fakeBackend({
  replies = [answer()],
  extractError = null,
  save,
  positions = POSITIONS,
  previewIds = ['2110202601'],
} = {}) {
  const state = {
    candidates: [],
    calls: [],
    replies: [...replies],
    extractError,
    positions: [...positions],
    previewIds: [...previewIds],
  };
  const json = (status, data) => ({ ok: status < 400, status, json: async () => data });

  vi.stubGlobal(
    'fetch',
    vi.fn(async (address, options = {}) => {
      const url = new URL(address, 'http://test.local');
      const path = url.pathname.replace('/api', '');
      const method = options.method ?? 'GET';
      state.calls.push({ path, method, search: url.search, body: options.body });

      if (path === '/lookups/positions' && method === 'GET') {
        return json(200, { items: state.positions });
      }
      if (path === '/candidates/next-id') {
        const next = state.previewIds.length > 1 ? state.previewIds.shift() : state.previewIds[0];
        return json(200, { candidateCode: next, preview: true });
      }
      if (path === '/lookups/sources') return json(200, { items: SOURCES });
      if (path === '/lookups/stages') return json(200, { items: [] });
      if (path === '/candidates/extract-cv/file' || path === '/candidates/extract-cv/link') {
        if (state.extractError) return json(state.extractError.status, state.extractError.body);
        const reply = state.replies.length > 1 ? state.replies.shift() : state.replies[0];
        const link = path.endsWith('/link') ? JSON.parse(options.body).url : null;
        return json(200, { ...reply, cvUrl: link });
      }
      if (path === '/candidates' && method === 'POST') {
        const data = JSON.parse(options.body);
        if (save) return save(data, state, json);
        const candidate = {
          id: 900 + state.candidates.length,
          stage: { code: 'applied' },
          ...data,
          candidateCode: `21102026${String(state.candidates.length + 1).padStart(2, '0')}`,
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
    <StrictMode>
      <AuthContext.Provider value={auth}>
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>
      </AuthContext.Provider>
    </StrictMode>,
  );
}

const pdf = (name = 'cv.pdf') => new File(['%PDF-1.4 made-up'], name, { type: 'application/pdf' });
const upload = (file = pdf()) =>
  fireEvent.change(screen.getByLabelText('Upload CV'), { target: { files: [file] } });
const field = (label) => screen.getByLabelText(label);
const value = (label) => field(label).value;
const type = (label, text) => fireEvent.change(field(label), { target: { value: text } });
// Types the link and clicks Read link: a link is only read when HR clicks the button.
const pasteLink = (url) => {
  fireEvent.change(field('CV link'), { target: { value: url } });
  fireEvent.click(screen.getByRole('button', { name: 'Read link' }));
};
const extractCalls = (backend) =>
  backend.calls.filter((c) => c.path.startsWith('/candidates/extract-cv'));
const posts = (backend) =>
  backend.calls.filter((c) => c.method === 'POST' && c.path === '/candidates');

async function ready() {
  await screen.findByLabelText('Upload CV');
  // The position and source lists have arrived.
  await waitFor(() => expect(field('Applied Position').options.length).toBeGreaterThan(1));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the Upload CV panel', () => {
  test('has no instruction paragraph, but keeps both inputs and the Save button', async () => {
    fakeBackend();
    open();
    await ready();
    expect(screen.queryByText(/Nothing is saved until you press Save/)).toBeNull();
    expect(screen.queryByText(/details found are put into the form/i)).toBeNull();
    expect(screen.queryByText(/registered straight away/i)).toBeNull();
    expect(screen.getByLabelText('Upload CV')).toBeTruthy();
    expect(screen.getByLabelText('CV link')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});

describe('uploading a CV fills the form by itself', () => {
  test('every stated detail appears in its field, with no banner and no confirmation', async () => {
    const backend = fakeBackend();
    open();
    await ready();
    upload();

    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(value('Phone Number 1')).toBe('0771234567');
    expect(value('Email')).toBe('anusha.perera@example.test');
    expect(value('Address')).toBe('12 Fictional Lane, Examplepura');
    expect(value('O/L Maths')).toBe('A');
    expect(value('A/L Result')).toBe('3 passes');
    expect(value('A/L Stream')).toBe('Physical Science');
    expect(value('Other Education')).toBe('BSc in Imaginary Computing, Fictional University');
    expect(value(/^Candidate ID/)).toMatch(/^\d{10}$/); // the preview

    // No separate confirmation or review banner of any kind.
    expect(screen.queryByText(/please check|please confirm|confirm it is correct/i)).toBeNull();
    expect(screen.queryByText(/^Use /)).toBeNull();
    expect(screen.queryByText(/Not found in the CV/)).toBeNull();
    expect(extractCalls(backend)).toHaveLength(1);
  });

  test('address and education arrive in their own fields, not together in the address', async () => {
    fakeBackend({
      replies: [
        answer({
          fullName: 'ANUSHA PERERA',
          phone: '0771234567',
          email: 'anusha.perera@example.test',
          address: '123 Example Road, Colombo, Sri Lanka',
          olMaths: 'A',
          alResult: '3 A passes',
          alStream: 'Physical Science',
        }),
      ],
    });
    open();
    await ready();
    upload();

    await waitFor(() => expect(value('Address')).toBe('123 Example Road, Colombo, Sri Lanka'));
    expect(value('O/L Maths')).toBe('A');
    expect(value('A/L Result')).toBe('3 A passes');
    expect(value('A/L Stream')).toBe('Physical Science');
    expect(value('Address')).not.toMatch(/O\/L|A\/L|Maths|Stream/);
    expect(value(/^Name/)).toBe('ANUSHA PERERA');
    expect(value('Phone Number 1')).toBe('0771234567');
    expect(value('Email')).toBe('anusha.perera@example.test');
    // No leftover warning about a missing Education section.
    expect(screen.queryByText(/Education/, { selector: '.panel__note' })).toBeNull();
  });

  test('a warning from the backend is still shown as a short note', async () => {
    fakeBackend({
      replies: [
        answer(
          { fullName: 'Kasun Dummyman' },
          {
            warnings: [
              'No "Education" section heading was found, so education fields were not read.',
            ],
          },
        ),
      ],
    });
    open();
    await ready();
    upload();
    expect(await screen.findByText(/No "Education" section heading was found/)).toBeTruthy();
  });

  test('extraction alone saves nothing and asks for no registration', async () => {
    const backend = fakeBackend();
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));

    expect(posts(backend)).toHaveLength(0);
    expect(extractCalls(backend)[0].search).toBe('');
    expect(screen.queryByText('Candidate registered')).toBeNull();
  });

  test('phones stay text: a leading 0 and a leading + are both kept', async () => {
    for (const phone of ['0771234567', '+94771234567']) {
      fakeBackend({ replies: [answer({ ...FULL_DRAFT, phone })] });
      open();
      await ready();
      upload();
      await waitFor(() => expect(value('Phone Number 1')).toBe(phone));
      cleanup();
      vi.unstubAllGlobals();
    }
  });

  test('missing details stay empty, and nothing is invented', async () => {
    fakeBackend({ replies: [answer({ fullName: 'Kasun Dummyman' })] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('Kasun Dummyman'));
    for (const label of [
      'Phone Number 1',
      'Email',
      'Address',
      'O/L Maths',
      'A/L Result',
      'A/L Stream',
    ]) {
      expect(value(label)).toBe('');
    }
    expect(value('Applied Position')).toBe('');
    expect(value('Source')).toBe('');
    expect(value('HR Comment')).toBe('');
  });

  test('an uploaded file gets no CV Link: no temporary or local address is invented', async () => {
    const backend = fakeBackend();
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(value('CV Link')).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Candidate registered');
    const sent = JSON.parse(posts(backend)[0].body);
    expect(sent.cvUrl).toBe('');
    expect(JSON.stringify(sent)).not.toMatch(/blob:|localhost|127\.0\.0\.1/);
  });

  test('the Company CV Link is never filled from a CV, and a typed one is kept', async () => {
    const backend = fakeBackend();
    open();
    await ready();
    type('Company CV Link', 'https://company.example.test/cv/1');
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(value('Company CV Link')).toBe('https://company.example.test/cv/1');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Candidate registered');
    expect(JSON.parse(posts(backend)[0].body).companyCvUrl).toBe(
      'https://company.example.test/cv/1',
    );
  });

  test('with no Company CV Link typed, the field stays empty', async () => {
    fakeBackend();
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(value('Company CV Link')).toBe('');
  });

  test('a file that cannot be read shows the reason and fills nothing', async () => {
    fakeBackend({
      extractError: {
        status: 422,
        body: { error: 'extraction_failed', message: 'The PDF has no readable text.' },
      },
    });
    open();
    await ready();
    upload();
    expect((await screen.findByRole('alert')).textContent).toContain('no readable text');
    expect(value(/^Name/)).toBe('');
  });

  test('a file that is not a PDF or Word file is refused before it is sent', async () => {
    const backend = fakeBackend();
    open();
    await ready();
    upload(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    expect((await screen.findByRole('alert')).textContent).toContain('PDF or Word');
    expect(extractCalls(backend)).toHaveLength(0);
  });

  test('a Word file without a reported type is recognised by its extension', async () => {
    const backend = fakeBackend();
    open();
    await ready();
    upload(new File(['PK made-up'], 'cv.docx', { type: '' }));
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(extractCalls(backend)).toHaveLength(1);
  });
});

describe('Applied Position and Source', () => {
  const stated = (appliedPosition, source) =>
    answer(FULL_DRAFT, { hints: { appliedPosition, source } });

  test('a position and source that match existing options are selected', async () => {
    fakeBackend({ replies: [stated('qa  intern', 'LinkedIn')] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('Applied Position')).toBe('7'));
    expect(value('Source')).toBe('3');
  });

  test('an unknown source or position stays unselected', async () => {
    fakeBackend({ replies: [stated('Rocket Scientist', 'Company Website')] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(value('Applied Position')).toBe('');
    expect(value('Source')).toBe('');
  });

  test('a switched-off option is never chosen', async () => {
    fakeBackend({ replies: [stated('Retired Role', null)] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(value('Applied Position')).toBe('');
  });

  test('with nothing stated, nothing is selected', async () => {
    fakeBackend();
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(value('Applied Position')).toBe('');
    expect(value('Source')).toBe('');
  });
});

describe('reading a CV link with the Read link button', () => {
  const URL_ = 'https://cv.example.test/anusha.pdf';

  test('fills the CV Link field and the form, once, when Read link is clicked', async () => {
    const backend = fakeBackend();
    open();
    await ready();
    pasteLink(URL_);

    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(value('CV Link')).toBe(URL_);
    expect(extractCalls(backend)).toHaveLength(1);
    expect(extractCalls(backend)[0].path).toBe('/candidates/extract-cv/link');
    expect(JSON.parse(extractCalls(backend)[0].body)).toEqual({ url: URL_ });
  });

  test('pasting, typing and leaving the box never start a read; only Read link does', async () => {
    const backend = fakeBackend();
    open();
    await ready();
    const input = field('CV link');
    for (const text of ['h', 'ht', 'https://', URL_]) {
      fireEvent.change(input, { target: { value: text } });
    }
    fireEvent.paste(input, { clipboardData: { getData: () => URL_ } });
    fireEvent.blur(input);
    fireEvent.focus(input);
    fireEvent.blur(input);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(extractCalls(backend)).toHaveLength(0);
    expect(value(/^Name/)).toBe('');
    expect(value('CV Link')).toBe(''); // the form is untouched until Read link

    fireEvent.click(screen.getByRole('button', { name: 'Read link' }));
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(extractCalls(backend)).toHaveLength(1);
    expect(value('CV Link')).toBe(URL_);
  });

  test('a double click on Read link sends one request', async () => {
    const backend = fakeBackend();
    open();
    await ready();
    fireEvent.change(field('CV link'), { target: { value: URL_ } });
    const button = screen.getByRole('button', { name: 'Read link' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(extractCalls(backend)).toHaveLength(1);
  });

  test('an answer that arrives after the page was left is ignored', async () => {
    const backend = fakeBackend();
    const view = open();
    await ready();
    let release;
    const original = fetch.getMockImplementation();
    fetch.mockImplementation(async (address, options) => {
      if (String(address).includes('/extract-cv/link')) {
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      return original(address, options);
    });
    fireEvent.change(field('CV link'), { target: { value: URL_ } });
    fireEvent.click(screen.getByRole('button', { name: 'Read link' }));
    await waitFor(() => expect(release).toBeTypeOf('function'));
    view.unmount();
    release();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(posts(backend)).toHaveLength(0); // nothing was applied or saved
  });

  test('an address that is not https is refused before anything is sent', async () => {
    const backend = fakeBackend();
    open();
    await ready();
    pasteLink('http://cv.example.test/anusha.pdf');
    expect((await screen.findByRole('alert')).textContent).toContain('https://');
    expect(extractCalls(backend)).toHaveLength(0);
    expect(value('CV Link')).toBe('');
  });

  test('the saved candidate carries the link', async () => {
    const backend = fakeBackend();
    open();
    await ready();
    pasteLink(URL_);
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Candidate registered');
    const sent = JSON.parse(posts(backend)[0].body);
    expect(sent.cvUrl).toBe(URL_);
    expect('candidateCode' in sent).toBe(false); // the ID is generated by the backend
  });

  test('a link the backend refuses shows the reason and keeps the pasted link', async () => {
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
    await ready();
    pasteLink(URL_);
    expect((await screen.findByRole('alert')).textContent).toContain('needs a sign-in');
    expect(value(/^Name/)).toBe('');
    expect(value('CV Link')).toBe(URL_);
  });
});

describe('manual corrections and ambiguity', () => {
  test('a field HR changed is kept when another CV is read, other fields update', async () => {
    fakeBackend({
      replies: [
        answer(FULL_DRAFT),
        answer({ ...FULL_DRAFT, fullName: 'KAMAL SILVA', email: 'kamal.silva@example.test' }),
      ],
    });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));

    type(/^Name/, 'Anusha P. Perera'); // HR's correction
    upload();
    await waitFor(() => expect(value('Email')).toBe('kamal.silva@example.test'));
    expect(value(/^Name/)).toBe('Anusha P. Perera');
  });

  test('a field typed before reading is not overwritten', async () => {
    fakeBackend();
    open();
    await ready();
    type('Phone Number 1', '0112223334');
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(value('Phone Number 1')).toBe('0112223334');
  });

  test('details a new CV does not state are cleared if an earlier CV had filled them', async () => {
    fakeBackend({
      replies: [answer(FULL_DRAFT), answer({ fullName: 'KAMAL SILVA' })],
    });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('Address')).toBe('12 Fictional Lane, Examplepura'));
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('KAMAL SILVA'));
    expect(value('Address')).toBe('');
    expect(value('Phone Number 1')).toBe('');
  });

  test('an ambiguous phone leaves the field empty with a short note under it, and no banner', async () => {
    fakeBackend({
      replies: [
        answer(
          { fullName: 'ANUSHA PERERA' },
          {
            fields: {
              phone: {
                status: 'uncertain',
                value: null,
                note: 'Several phone numbers were found (0771234567, 0712345678). Enter the right one.',
                alternatives: ['0771234567', '0712345678'],
              },
            },
            review: { extracted: ['fullName'], uncertain: ['phone'], unavailable: [] },
          },
        ),
      ],
    });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));

    expect(value('Phone Number 1')).toBe('');
    expect(screen.getByText(/Several phone numbers were found/)).toBeTruthy();
    expect(screen.queryByText(/^Use /)).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    // Typing in the field makes the note go away.
    type('Phone Number 1', '0771234567');
    expect(screen.queryByText(/Several phone numbers were found/)).toBeNull();
  });
});

describe('two phone numbers and several emails', () => {
  const TWO = answer(
    { ...FULL_DRAFT, phone: '+94771234567', phone2: '0712345678' },
    {
      fields: {
        phone: {
          status: 'extracted',
          value: '+94771234567',
          note: 'Several phone numbers were found (+94771234567, 0712345678). The first is Phone Number 1 and the second is Phone Number 2.',
          alternatives: ['0712345678'],
        },
        email: {
          status: 'extracted',
          value: 'anusha.perera@example.test',
          note: 'More than one email address was found (other@example.test also). The first is used; change it if needed.',
          alternatives: ['other@example.test'],
        },
      },
    },
  );

  test('both numbers and the email fill their fields, with a note HR can ignore', async () => {
    fakeBackend({ replies: [TWO] });
    open();
    await ready();
    upload();

    await waitFor(() => expect(value('Phone Number 1')).toBe('+94771234567'));
    expect(value('Phone Number 2')).toBe('0712345678');
    expect(value('Email')).toBe('anusha.perera@example.test');
    expect(screen.getByText(/More than one email address was found/)).toBeTruthy();
    // HR can change either number.
    type('Phone Number 2', '0700000009');
    expect(value('Phone Number 2')).toBe('0700000009');
  });

  test('one number leaves Phone Number 2 empty', async () => {
    fakeBackend();
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('Phone Number 1')).toBe('0771234567'));
    expect(value('Phone Number 2')).toBe('');
  });

  test('Phone Number 2 is a draft: it is never sent when saving', async () => {
    const backend = fakeBackend({ replies: [TWO] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('Phone Number 2')).toBe('0712345678'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const box = (await screen.findByText('Candidate registered')).closest('.notice');
    expect(box.textContent).toMatch(/Phone Number 2 was not saved/);
    const sent = JSON.parse(posts(backend)[0].body);
    expect(sent.phone).toBe('+94771234567');
    expect('phone2' in sent).toBe(false);
  });

  test('removing the CV clears both numbers it filled', async () => {
    fakeBackend({ replies: [TWO] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('Phone Number 2')).toBe('0712345678'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove CV' }));
    expect(value('Phone Number 1')).toBe('');
    expect(value('Phone Number 2')).toBe('');
    expect(value('Email')).toBe('');
  });
});

describe('saving and duplicates are unchanged', () => {
  const EXISTING = {
    id: 7,
    candidateCode: '2010202601',
    fullName: 'ANUSHA PERERA',
    matchedOn: ['phone'],
    phone: null,
    email: null,
    position: null,
  };

  test('a possible existing candidate is not announced when the CV is read', async () => {
    fakeBackend({ replies: [{ ...answer(), duplicates: [EXISTING] }] });
    open();
    await ready();
    upload();

    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(screen.queryByText('This person may already be a candidate')).toBeNull();
    expect(value(/^Name/)).toBe('ANUSHA PERERA'); // HR decides; nothing was saved
  });

  test('Save is still warned about a likely duplicate and never overrides it itself', async () => {
    const backend = fakeBackend({
      save: (data, state, json) =>
        data.confirmDuplicate
          ? json(201, {
              candidate: { id: 950, candidateCode: '2110202602', fullName: data.fullName },
            })
          : json(409, { error: 'possible_duplicate', duplicates: [EXISTING] }),
    });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await screen.findByText('This may be a duplicate. Nothing has been saved yet.');
    expect(screen.queryByText('Candidate registered')).toBeNull();
    expect(JSON.parse(posts(backend)[0].body).confirmDuplicate).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Save as a separate candidate' }));
    await screen.findByText('Candidate registered');
    expect(JSON.parse(posts(backend)[1].body).confirmDuplicate).toBe(true);
  });

  test('after the backend confirms the save, the generated ID and links are shown', async () => {
    fakeBackend();
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const box = (await screen.findByText('Candidate registered')).closest('.notice');
    expect(box.textContent).toContain('2110202601');
    expect(within(box).getByRole('link', { name: 'View Candidate' }).getAttribute('href')).toBe(
      '/candidates/900',
    );
    expect(within(box).getByRole('link', { name: 'Candidate List' }).getAttribute('href')).toBe(
      '/candidates',
    );
  });

  test('the Candidate List shows the saved candidate without a page reload', async () => {
    fakeBackend();
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const box = (await screen.findByText('Candidate registered')).closest('.notice');
    fireEvent.click(within(box).getByRole('link', { name: 'Candidate List' }));
    expect(await screen.findByText('2110202601')).toBeTruthy();
  });
});

describe('permissions and editing', () => {
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

describe('the fill rules on their own', () => {
  test('matchLookup needs exactly one active option with the same name', () => {
    const items = [
      { id: 1, name: 'QA Intern', isActive: true },
      { id: 2, name: 'Old Role', isActive: false },
      { id: 3, name: 'Twin', isActive: true },
      { id: 4, name: 'twin', isActive: true },
    ];
    expect(matchLookup(items, ' qa-intern ')).toBe('1');
    expect(matchLookup(items, 'Old Role')).toBeNull();
    expect(matchLookup(items, 'Twin')).toBeNull(); // two options: not a clear match
    expect(matchLookup(items, 'Quality Assurance')).toBeNull();
    expect(matchLookup(items, '')).toBeNull();
    expect(matchLookup(null, 'x')).toBeNull();
  });

  test('fillFields fills empty fields and keeps typed ones', () => {
    const { values, autoFilled } = fillFields({
      values: { fullName: '', phone: '0112223334', email: '' },
      autoFilled: {},
      found: { fullName: 'A B', phone: '0771234567', email: 'a@example.test' },
      clearStale: true,
    });
    expect(values).toEqual({ fullName: 'A B', phone: '0112223334', email: 'a@example.test' });
    expect(autoFilled).toEqual({ fullName: 'A B', email: 'a@example.test' });
  });
});

describe('the Candidate ID', () => {
  const idCalls = (backend) => backend.calls.filter((c) => c.path === '/candidates/next-id');

  test('is empty when Add Candidate opens, with no instruction text, and read-only', async () => {
    const backend = fakeBackend();
    open();
    await ready();
    const box = screen.getByLabelText(/^Candidate ID/);
    expect(box.value).toBe('');
    expect(box.disabled).toBe(true);
    expect(screen.queryByText(/Generated automatically/i)).toBeNull();
    expect(screen.queryByText(/DDMMYYYY/)).toBeNull();
    expect(screen.queryByText(/It never changes/)).toBeNull();
    expect(idCalls(backend)).toHaveLength(0); // nothing is even asked for yet
  });

  test('stays empty while registering by hand with no CV', async () => {
    const backend = fakeBackend();
    open();
    await ready();
    type(/^Name/, 'Typed By Hand');
    type('Phone Number 1', '0771234567');
    expect(value(/^Candidate ID/)).toBe('');
    expect(idCalls(backend)).toHaveLength(0);
  });

  test('appears after a CV is read, and nothing is reserved or saved', async () => {
    const backend = fakeBackend({ previewIds: ['2110202601'] });
    open();
    await ready();
    expect(value(/^Candidate ID/)).toBe('');
    upload();
    await waitFor(() => expect(value(/^Candidate ID/)).toBe('2110202601'));
    expect(screen.getByLabelText(/^Candidate ID/).disabled).toBe(true);
    expect(posts(backend)).toHaveLength(0);
  });

  test('appears after a pasted CV link is read, too', async () => {
    fakeBackend({ previewIds: ['2110202601'] });
    open();
    await ready();
    pasteLink('https://cv.example.test/anusha.pdf');
    await waitFor(() => expect(value(/^Candidate ID/)).toBe('2110202601'));
  });

  test('is refreshed by each read, and Save shows the ID the backend really assigned', async () => {
    fakeBackend({
      previewIds: ['2110202601', '2110202602'],
      save: (data, state, json) =>
        json(201, {
          candidate: { id: 77, candidateCode: '2110202603', fullName: data.fullName },
        }),
    });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Candidate ID/)).toBe('2110202601'));
    upload(); // another registration happened meanwhile
    await waitFor(() => expect(value(/^Candidate ID/)).toBe('2110202602'));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const box = (await screen.findByText('Candidate registered')).closest('.notice');
    expect(box.textContent).toContain('2110202603'); // the final ID, not the preview
    expect(box.textContent).not.toContain('2110202602');
  });

  test('clears when a later read fails', async () => {
    const backend = fakeBackend();
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Candidate ID/)).toBe('2110202601'));

    backend.extractError = {
      status: 422,
      body: { error: 'extraction_failed', message: 'The PDF has no readable text.' },
    };
    upload();
    expect((await screen.findByRole('alert')).textContent).toContain('no readable text');
    expect(value(/^Candidate ID/)).toBe('');
  });

  test('clears when a file is turned down before it is sent', async () => {
    fakeBackend();
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Candidate ID/)).toBe('2110202601'));
    upload(new File(['hello'], 'notes.txt', { type: 'text/plain' }));
    await screen.findByRole('alert');
    expect(value(/^Candidate ID/)).toBe('');
  });

  test('is never shown when the very first read fails', async () => {
    fakeBackend({
      extractError: { status: 422, body: { error: 'extraction_failed', message: 'Unreadable.' } },
    });
    open();
    await ready();
    upload();
    await screen.findByRole('alert');
    expect(value(/^Candidate ID/)).toBe('');
  });

  test('clears when the CV is removed, with the details it filled but not what HR typed', async () => {
    fakeBackend();
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Candidate ID/)).toBe('2110202601'));
    type('Address', 'Typed By HR'); // HR changed this one

    fireEvent.click(screen.getByRole('button', { name: 'Remove CV' }));

    expect(value(/^Candidate ID/)).toBe('');
    expect(value(/^Name/)).toBe('');
    expect(value('Email')).toBe('');
    expect(value('Address')).toBe('Typed By HR');
    expect(screen.queryByRole('button', { name: 'Remove CV' })).toBeNull();
  });

  test('a preview answer that arrives after the CV was removed is ignored', async () => {
    const backend = fakeBackend();
    open();
    await ready();
    let release;
    const original = fetch.getMockImplementation();
    fetch.mockImplementation(async (address, options) => {
      if (String(address).includes('/candidates/next-id')) {
        await new Promise((resolve) => {
          release = resolve;
        });
      }
      return original(address, options);
    });
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    fireEvent.click(screen.getByRole('button', { name: 'Remove CV' }));
    release();
    await waitFor(() => expect(idCalls(backend).length).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(value(/^Candidate ID/)).toBe('');
  });

  test('the preview is never sent as the ID when saving', async () => {
    const backend = fakeBackend();
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Candidate ID/)).toBe('2110202601'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Candidate registered');
    expect('candidateCode' in JSON.parse(posts(backend)[0].body)).toBe(false);
  });
});

describe('Applied Position from the CV', () => {
  const OPTIONS = [
    { id: 1, name: 'HR', isActive: true },
    { id: 2, name: 'Intern', isActive: true },
    { id: 3, name: 'Software Developer', isActive: true },
    { id: 4, name: 'UI/UX Designer', isActive: true },
  ];
  const stated = (appliedPosition, source = null) =>
    answer(FULL_DRAFT, { hints: { appliedPosition, source } });
  const MAIN_USER = {
    ...SIGNED_IN,
    user: {
      ...SIGNED_IN.user,
      permissions: ['candidates.view', 'candidates.edit', 'admin.manage'],
    },
  };

  test('a stated position that exists is selected in the dropdown', async () => {
    fakeBackend({ positions: OPTIONS, replies: [stated('Software Developer')] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('Applied Position')).toBe('3'));
  });

  test('HR as the applied position selects HR', async () => {
    fakeBackend({ positions: OPTIONS, replies: [stated('HR')] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('Applied Position')).toBe('1'));
  });

  test('capitalisation and spacing do not matter', async () => {
    fakeBackend({ positions: OPTIONS, replies: [stated('  ui / ux   DESIGNER ')] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('Applied Position')).toBe('4'));
  });

  test('earlier job experience alone selects nothing', async () => {
    fakeBackend({ positions: OPTIONS, replies: [stated(null)] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(value('Applied Position')).toBe('');
    expect(screen.queryByText(/It is not in the position list/)).toBeNull();
  });

  test('HR can change the selected position, and a later CV does not overwrite that', async () => {
    const backend = fakeBackend({
      positions: OPTIONS,
      replies: [stated('Software Developer'), stated('Intern')],
    });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('Applied Position')).toBe('3'));
    fireEvent.change(field('Applied Position'), { target: { value: '1' } }); // HR picks HR
    upload();
    await waitFor(() => expect(extractCalls(backend)).toHaveLength(2));
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(value('Applied Position')).toBe('1');
  });

  test('a position that is not in the list is shown as a suggestion, and nothing is created', async () => {
    const backend = fakeBackend({ positions: OPTIONS, replies: [stated('Rocket Scientist')] });
    open();
    await ready();
    upload();

    expect(await screen.findByText(/Suggested from CV: Rocket Scientist/)).toBeTruthy();
    expect(value('Applied Position')).toBe('');
    // The dropdown holds only the real options.
    expect(field('Applied Position').options).toHaveLength(OPTIONS.length + 1);
    const writes = backend.calls.filter(
      (c) => c.method === 'POST' && c.path.startsWith('/lookups'),
    );
    expect(writes).toHaveLength(0);
  });

  test('a user who may manage positions finds Add New Position and a way to refresh', async () => {
    fakeBackend({ positions: OPTIONS, replies: [stated('Rocket Scientist')] });
    open('/candidates/new', MAIN_USER);
    await ready();
    upload();

    const hint = (await screen.findByText(/Suggested from CV: Rocket Scientist/)).closest('p');
    const link = within(hint).getByRole('link', { name: 'Add New Position' });
    expect(link.getAttribute('href')).toBe('/admin/lookups');
    expect(within(hint).getByRole('button', { name: 'Refresh list' })).toBeTruthy();
  });

  test('HR without permission is told so, and gets no Add New Position', async () => {
    const backend = fakeBackend({ positions: OPTIONS, replies: [stated('Rocket Scientist')] });
    open();
    await ready();
    upload();

    const hint = (await screen.findByText(/Suggested from CV: Rocket Scientist/)).closest('p');
    expect(hint.textContent).toContain('You do not have permission to add positions');
    expect(within(hint).queryByRole('link', { name: 'Add New Position' })).toBeNull();
    expect(within(hint).queryByRole('button', { name: 'Refresh list' })).toBeNull();
    // HR can still choose an existing one.
    fireEvent.change(field('Applied Position'), { target: { value: '2' } });
    expect(value('Applied Position')).toBe('2');
    expect(screen.queryByText(/Suggested from CV: Rocket Scientist/)).toBeNull();
    const writes = backend.calls.filter(
      (c) => c.method === 'POST' && c.path.startsWith('/lookups'),
    );
    expect(writes).toHaveLength(0);
  });

  test('after an administrator adds the position, Refresh list selects it', async () => {
    const backend = fakeBackend({ positions: OPTIONS, replies: [stated('Rocket Scientist')] });
    open('/candidates/new', MAIN_USER);
    await ready();
    upload();
    await screen.findByText(/Suggested from CV: Rocket Scientist/);

    backend.positions.push({ id: 9, name: 'Rocket Scientist', isActive: true }); // added elsewhere
    fireEvent.click(screen.getByRole('button', { name: 'Refresh list' }));

    await waitFor(() => expect(value('Applied Position')).toBe('9'));
    expect(screen.queryByText(/It is not in the position list/)).toBeNull();
  });
});

describe('Source from the CV', () => {
  const withSource = (source) => answer(FULL_DRAFT, { hints: { appliedPosition: null, source } });

  test('a reliable source that exists is selected', async () => {
    fakeBackend({ replies: [withSource('LinkedIn')] });
    open();
    await ready();
    upload();
    // Only the configured option list is used, never a built-in one.
    await waitFor(() => expect(value('Source')).toBe('3'));
  });

  test('an unknown source stays on Select… and HR can choose one', async () => {
    fakeBackend({ replies: [withSource('Facebook')] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(value('Source')).toBe('');
    fireEvent.change(field('Source'), { target: { value: '3' } });
    expect(value('Source')).toBe('3');
  });

  test('no source stated means no source selected', async () => {
    fakeBackend({ replies: [withSource(null)] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(value('Source')).toBe('');
  });

  test('a link on a LinkedIn address does not make LinkedIn the source', async () => {
    fakeBackend({ replies: [withSource(null)] });
    open();
    await ready();
    pasteLink('https://www.linkedin.example.test/in/anusha-perera/cv.pdf');
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(value('Source')).toBe('');
  });

  test('a source HR chose is kept when another CV is read', async () => {
    const backend = fakeBackend({ replies: [withSource(null), withSource('LinkedIn')] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    fireEvent.change(field('Source'), { target: { value: '4' } }); // HR picks another option
    upload();
    await waitFor(() => expect(extractCalls(backend)).toHaveLength(2));
    expect(value('Source')).toBe('4');
  });
});

describe('a target job title or career objective', () => {
  const OPTIONS = [
    { id: 1, name: 'HR', isActive: true },
    { id: 3, name: 'Software Developer', isActive: true },
  ];
  const target = (targetPosition, appliedPosition = null) =>
    answer(FULL_DRAFT, { hints: { appliedPosition, targetPosition, source: null } });

  test('one that equals an existing position selects it, with no message', async () => {
    fakeBackend({ positions: OPTIONS, replies: [target('Software Developer')] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('Applied Position')).toBe('3'));
    expect(screen.queryByText(/Suggested from CV/)).toBeNull();
  });

  test('one that matches no position is shown as "Suggested from CV", nothing is selected or created', async () => {
    const backend = fakeBackend({ positions: OPTIONS, replies: [target('Rocket Scientist')] });
    open();
    await ready();
    upload();

    const hint = (await screen.findByText(/Suggested from CV: Rocket Scientist/)).closest('p');
    expect(hint.textContent).toContain('Choose an existing position');
    expect(value('Applied Position')).toBe('');
    fireEvent.change(field('Applied Position'), { target: { value: '1' } });
    expect(value('Applied Position')).toBe('1');
    expect(screen.queryByText(/Suggested from CV/)).toBeNull();
    const writes = backend.calls.filter(
      (c) => c.method === 'POST' && c.path.startsWith('/lookups'),
    );
    expect(writes).toHaveLength(0);
  });

  test('a stated applied position wins over the target role', async () => {
    fakeBackend({ positions: OPTIONS, replies: [target('HR', 'Software Developer')] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('Applied Position')).toBe('3'));
  });

  test('a stated applied position that is unknown is not replaced by the target role', async () => {
    fakeBackend({ positions: OPTIONS, replies: [target('HR', 'Rocket Scientist')] });
    open();
    await ready();
    upload();
    await screen.findByText(/Suggested from CV: Rocket Scientist/);
    expect(value('Applied Position')).toBe('');
  });

  test('HR can change an automatically selected position, and it stays changed', async () => {
    const backend = fakeBackend({
      positions: OPTIONS,
      replies: [target('Software Developer'), target('Software Developer')],
    });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('Applied Position')).toBe('3'));
    fireEvent.change(field('Applied Position'), { target: { value: '1' } });
    expect(value('Applied Position')).toBe('1');

    upload(); // the CV is read again
    await waitFor(() => expect(extractCalls(backend)).toHaveLength(2));
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(value('Applied Position')).toBe('1');
  });

  test('a position HR chose before reading is not replaced', async () => {
    fakeBackend({ positions: OPTIONS, replies: [target('Software Developer')] });
    open();
    await ready();
    fireEvent.change(field('Applied Position'), { target: { value: '1' } });
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(value('Applied Position')).toBe('1');
  });

  test('the suggestion goes away with the CV, and so does an automatic selection', async () => {
    fakeBackend({ positions: OPTIONS, replies: [target('Rocket Scientist')] });
    open();
    await ready();
    upload();
    await screen.findByText(/Suggested from CV/);
    fireEvent.click(screen.getByRole('button', { name: 'Remove CV' }));
    expect(screen.queryByText(/Suggested from CV/)).toBeNull();
  });

  test('no target and no stated position: no suggestion at all', async () => {
    fakeBackend({ positions: OPTIONS, replies: [target(null)] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(screen.queryByText(/Suggested from CV/)).toBeNull();
    expect(value('Applied Position')).toBe('');
    // The empty dropdown is explained rather than left silent, until HR chooses.
    expect(screen.getByText(/No applied position was found in the CV/)).toBeTruthy();
    fireEvent.change(field('Applied Position'), { target: { value: '1' } });
    expect(screen.queryByText(/No applied position was found/)).toBeNull();
  });

  test('the note is not shown when a position was found and selected', async () => {
    fakeBackend({ positions: OPTIONS, replies: [target('Software Developer')] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('Applied Position')).toBe('3'));
    expect(screen.queryByText(/No applied position was found/)).toBeNull();
  });
});

describe('the LinkedIn Link field', () => {
  const PROFILE = 'https://www.linkedin.com/in/example-profile';
  const withLinkedin = (url, extra = {}) =>
    answer({ ...FULL_DRAFT, ...(url ? { linkedinUrl: url } : {}) }, extra);
  const NOTE = /The LinkedIn link was not saved/;

  test('is visible on Add Candidate, empty, optional and next to Email', async () => {
    fakeBackend();
    open();
    await ready();
    const box = field('LinkedIn Link');
    expect(box.value).toBe('');
    expect(box.required).toBe(false);
    expect(screen.queryByText(/LinkedIn Link.*\(required\)/)).toBeNull();
    const order = (a, b) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(order(field('Email'), box)).toBe(true);
    expect(order(box, field('Address'))).toBe(true);
    expect(screen.getAllByText(/Not saved with the candidate yet/).length).toBeGreaterThan(0);
  });

  test('a CV with a profile address fills it, with the other details', async () => {
    fakeBackend({ replies: [withLinkedin(PROFILE)] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('LinkedIn Link')).toBe(PROFILE));
    expect(value(/^Name/)).toBe('ANUSHA PERERA');
    expect(value('Phone Number 1')).toBe('0771234567');
    expect(value('Email')).toBe('anusha.perera@example.test');
    expect(value('Address')).toBe('12 Fictional Lane, Examplepura');
  });

  test('a pasted CV link fills it too', async () => {
    fakeBackend({ replies: [withLinkedin(PROFILE)] });
    open();
    await ready();
    pasteLink('https://cv.example.test/anusha.pdf');
    await waitFor(() => expect(value('LinkedIn Link')).toBe(PROFILE));
    expect(value('CV Link')).toBe('https://cv.example.test/anusha.pdf');
  });

  test('a CV without one leaves it empty', async () => {
    fakeBackend({ replies: [withLinkedin(null)] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(value('LinkedIn Link')).toBe('');
  });

  test('a LinkedIn profile does not set the Source', async () => {
    fakeBackend({ replies: [withLinkedin(PROFILE)] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('LinkedIn Link')).toBe(PROFILE));
    expect(value('Source')).toBe('');
  });

  test('HR can add one by hand, change it, and remove it', async () => {
    fakeBackend({ replies: [withLinkedin(null)] });
    open();
    await ready();
    type('LinkedIn Link', 'https://www.linkedin.com/in/typed-by-hr');
    expect(value('LinkedIn Link')).toBe('https://www.linkedin.com/in/typed-by-hr');
    type('LinkedIn Link', 'https://www.linkedin.com/in/changed');
    expect(value('LinkedIn Link')).toBe('https://www.linkedin.com/in/changed');
    type('LinkedIn Link', '');
    expect(value('LinkedIn Link')).toBe('');
  });

  test('what HR typed is kept when a CV is read; a value the CV filled is replaced', async () => {
    const backend = fakeBackend({
      replies: [withLinkedin(PROFILE), withLinkedin('https://www.linkedin.com/in/second-cv')],
    });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('LinkedIn Link')).toBe(PROFILE));

    upload(); // untouched, so the next CV's value replaces it
    await waitFor(() =>
      expect(value('LinkedIn Link')).toBe('https://www.linkedin.com/in/second-cv'),
    );

    type('LinkedIn Link', 'https://www.linkedin.com/in/hr-correction');
    upload(); // the same CV read again
    await waitFor(() => expect(extractCalls(backend)).toHaveLength(3));
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    expect(value('LinkedIn Link')).toBe('https://www.linkedin.com/in/hr-correction');
  });

  test('removing the CV clears the value it filled, but not one HR typed', async () => {
    fakeBackend({ replies: [withLinkedin(PROFILE)] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('LinkedIn Link')).toBe(PROFILE));
    fireEvent.click(screen.getByRole('button', { name: 'Remove CV' }));
    expect(value('LinkedIn Link')).toBe('');
  });

  test('two different profiles in the CV: nothing is filled, a short note says why', async () => {
    fakeBackend({
      replies: [
        answer(
          { fullName: 'ANUSHA PERERA' },
          {
            fields: {
              linkedinUrl: {
                status: 'uncertain',
                value: null,
                note: 'More than one LinkedIn profile was found. Enter the right one.',
                alternatives: [PROFILE, 'https://www.linkedin.com/in/other'],
              },
            },
            review: { extracted: ['fullName'], uncertain: ['linkedinUrl'], unavailable: [] },
          },
        ),
      ],
    });
    open();
    await ready();
    upload();
    expect(await screen.findByText(/More than one LinkedIn profile was found/)).toBeTruthy();
    expect(value('LinkedIn Link')).toBe('');
  });

  test('it is never sent to the backend, and the page says it was not saved', async () => {
    const backend = fakeBackend({ replies: [withLinkedin(PROFILE)] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('LinkedIn Link')).toBe(PROFILE));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const box = (await screen.findByText('Candidate registered')).closest('.notice');
    expect(box.textContent).toMatch(NOTE);
    const body = posts(backend)[0].body;
    expect(body).not.toMatch(/linkedin/i);
    const sent = JSON.parse(body);
    expect('linkedinUrl' in sent).toBe(false);
    // Nothing about the link ended up in another field.
    expect(sent.cvUrl).toBe('');
    expect(sent.hrComment).toBe('');
    expect(sent.companyCvUrl).toBe('');
  });

  test('with no LinkedIn link there is no "not saved" message', async () => {
    fakeBackend({ replies: [withLinkedin(null)] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const box = (await screen.findByText('Candidate registered')).closest('.notice');
    expect(box.textContent).not.toMatch(NOTE);
  });

  test('an address that is not a personal LinkedIn profile stops the save and is explained', async () => {
    const backend = fakeBackend({ replies: [withLinkedin(null)] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));

    for (const bad of [
      'https://www.linkedin.com/company/example-ltd',
      'http://www.linkedin.com/in/example-profile',
      'https://example.test/in/example-profile',
      'https://linkedin.com.example.test/in/example-profile',
      'not a link',
    ]) {
      type('LinkedIn Link', bad);
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText(/Enter a LinkedIn profile address/)).toBeTruthy();
      expect(posts(backend)).toHaveLength(0);
    }
  });

  test('a valid profile or a blank field saves; blank is allowed', async () => {
    const backend = fakeBackend({ replies: [withLinkedin(null)] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('ANUSHA PERERA'));
    type('LinkedIn Link', 'https://uk.linkedin.com/in/example-profile/');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Candidate registered');
    expect(posts(backend)).toHaveLength(1);
  });

  test('Edit Candidate does not offer it', async () => {
    fakeBackend();
    open('/candidates/5/edit');
    await waitFor(() => expect(screen.queryByLabelText('LinkedIn Link')).toBeNull());
  });

  test('the address is not swallowed by, nor does it swallow, the LinkedIn value', async () => {
    fakeBackend({ replies: [withLinkedin(PROFILE)] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('LinkedIn Link')).toBe(PROFILE));
    expect(value('Address')).not.toMatch(/linkedin/i);
    expect(value('CV Link')).toBe('');
  });
});

describe('re-reading and removing a CV, as the real app runs (React StrictMode)', () => {
  const FIRST = {
    fullName: 'FIRST PERSON',
    phone: '0771111111',
    email: 'first.person@example.test',
    address: '1 First Road, Colombo',
    otherEducation: 'BSc in First Studies, First University',
  };
  const SECOND = {
    fullName: 'SECOND PERSON',
    email: 'second.person@example.test',
    address: '2 Second Road, Kandy',
    otherEducation: 'Diploma in Second Studies, Second Institute',
  };

  test('a second document replaces everything the first one filled in', async () => {
    fakeBackend({ replies: [answer(FIRST), answer(SECOND)] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('Address')).toBe('1 First Road, Colombo'));

    upload();
    await waitFor(() => expect(value('Address')).toBe('2 Second Road, Kandy'));
    expect(value(/^Name/)).toBe('SECOND PERSON');
    expect(value('Email')).toBe('second.person@example.test');
    expect(value('Other Education')).toBe('Diploma in Second Studies, Second Institute');
    // The second document has no phone, so the first one's phone must not linger.
    expect(value('Phone Number 1')).toBe('');
  });

  test('the same holds when the CV is read from a pasted link', async () => {
    fakeBackend({ replies: [answer(FIRST), answer(SECOND)] });
    open();
    await ready();
    pasteLink('https://cv.example.test/one.pdf');
    await waitFor(() => expect(value('Address')).toBe('1 First Road, Colombo'));
    expect(value('CV Link')).toBe('https://cv.example.test/one.pdf');

    pasteLink('https://cv.example.test/two.pdf');
    await waitFor(() => expect(value('Address')).toBe('2 Second Road, Kandy'));
    expect(value(/^Name/)).toBe('SECOND PERSON');
    expect(value('CV Link')).toBe('https://cv.example.test/two.pdf');
    expect(value('Phone Number 1')).toBe('');
  });

  test('Read link after a paste does not undo or duplicate the fill', async () => {
    const backend = fakeBackend({ replies: [answer(FIRST)] });
    open();
    await ready();
    pasteLink('https://cv.example.test/one.pdf');
    await waitFor(() => expect(value(/^Name/)).toBe('FIRST PERSON'));
    fireEvent.click(screen.getByRole('button', { name: 'Read link' }));
    await waitFor(() => expect(extractCalls(backend)).toHaveLength(2));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Read link' }).disabled).toBe(false),
    );
    expect(value(/^Name/)).toBe('FIRST PERSON');
    expect(value('Address')).toBe('1 First Road, Colombo');
    expect(value('CV Link')).toBe('https://cv.example.test/one.pdf');
  });

  test('a value HR corrected survives the next document; the rest is replaced', async () => {
    fakeBackend({ replies: [answer(FIRST), answer(SECOND)] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('Address')).toBe('1 First Road, Colombo'));
    type('Phone Number 1', '0779999999'); // HR's own phone
    type('Address', 'HR corrected address');

    upload();
    await waitFor(() => expect(value(/^Name/)).toBe('SECOND PERSON'));
    expect(value('Phone Number 1')).toBe('0779999999');
    expect(value('Address')).toBe('HR corrected address');
    expect(value('Other Education')).toBe('Diploma in Second Studies, Second Institute');
  });

  test('Remove CV clears what the CV filled, the link and the ID preview, but not what HR typed', async () => {
    fakeBackend({ replies: [answer(FIRST)] });
    open();
    await ready();
    pasteLink('https://cv.example.test/one.pdf');
    await waitFor(() => expect(value(/^Candidate ID/)).toMatch(/^\d{10}$/));
    type('Phone Number 1', '0779999999'); // HR changed the phone

    fireEvent.click(screen.getByRole('button', { name: 'Remove CV' }));

    expect(value(/^Name/)).toBe('');
    expect(value('Email')).toBe('');
    expect(value('Address')).toBe('');
    expect(value('Other Education')).toBe('');
    expect(value('CV Link')).toBe('');
    expect(value(/^Candidate ID/)).toBe('');
    expect(value('Phone Number 1')).toBe('0779999999');
  });

  test('a document that fails to read leaves the earlier fill alone', async () => {
    const backend = fakeBackend({ replies: [answer(FIRST)] });
    open();
    await ready();
    upload();
    await waitFor(() => expect(value('Address')).toBe('1 First Road, Colombo'));
    backend.extractError = {
      status: 422,
      body: { error: 'extraction_failed', message: 'Unreadable.' },
    };
    upload();
    await screen.findByRole('alert');
    expect(value('Address')).toBe('1 First Road, Colombo');
    expect(value(/^Candidate ID/)).toBe('');
  });
});

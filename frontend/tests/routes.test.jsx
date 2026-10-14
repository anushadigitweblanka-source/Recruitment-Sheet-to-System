import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, test } from 'vitest';
import App from '../src/App.jsx';
import { AuthContext } from '../src/auth/AuthContext.jsx';
import { allPages, findPage, modules } from '../src/navigation.js';

// These tests look at the pages as a signed-in user sees them.
// Signing in, signing out and redirects are covered in auth.test.jsx.
const SIGNED_IN = {
  status: 'authenticated',
  user: {
    id: 1,
    email: 'test.user@example.test',
    fullName: 'Test User',
    role: { code: 'main_user', name: 'Main User' },
    permissions: [],
  },
  login: async () => ({ ok: true }),
  logout: async () => ({ ok: true }),
};

function renderAt(path) {
  return renderToString(
    <AuthContext.Provider value={SIGNED_IN}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const escapeHtml = (text) => text.replaceAll('&', '&amp;');

// A real address for a page: "/candidates/:id/edit" becomes "/candidates/1/edit".
const addressOf = (page) => page.path.replace(':id', '1');

const REQUIRED_ROUTES = [
  '/candidates',
  '/candidates/new',
  '/candidates/:id',
  '/candidates/:id/edit',
  '/phone-interviews',
  '/phone-interviews/:id',
  '/interviews',
  '/interviews/:id',
  '/offers',
  '/offers/new',
  '/offers/:id',
  '/offers/:id/edit',
  '/employees',
  '/employees/:id',
  '/employees/:id/lifecycle',
  '/employees/:id/edit',
  '/notifications',
  '/email-templates',
  '/email-log',
  '/admin/system-status',
];

describe('navigation config', () => {
  test('every page has a unique path', () => {
    const paths = allPages.map((page) => page.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  test('every page has a label, a description and a component', () => {
    for (const page of allPages) {
      expect(page.label, page.path).toBeTruthy();
      expect(page.description, page.path).toBeTruthy();
      expect(page.component, page.path).toBeTypeOf('function');
    }
  });

  test('every page is in the sidebar or names the sidebar link it belongs to', () => {
    const navPaths = allPages.filter((page) => page.nav).map((page) => page.path);
    for (const page of allPages) {
      if (!page.nav) expect(navPaths, page.path).toContain(page.navParent);
    }
  });

  test('all required routes exist', () => {
    const paths = allPages.map((page) => page.path);
    for (const route of REQUIRED_ROUTES) expect(paths).toContain(route);
  });

  test('a fixed address wins over a parameter', () => {
    expect(findPage('/candidates/new').label).toBe('Add Candidate');
    expect(findPage('/candidates/12').label).toBe('Candidate Details');
    expect(findPage('/employees/phase/probation').label).toBe('Probation');
    expect(findPage('/employees/7').label).toBe('Employee Details');
  });
});

describe('the six modules', () => {
  test('are numbered 1 to 6 with the official names', () => {
    expect(modules.map((module) => `${module.number} ${module.title}`)).toEqual([
      '1 Candidate Management',
      '2 Phone Interview',
      '3 Direct Interview',
      '4 Offer Management',
      '5 Employee Lifecycle Dashboard',
      '6 Email Notifications',
    ]);
  });

  test('each appears in the sidebar by its name, without its number', () => {
    const html = renderAt('/dashboard');
    for (const module of modules) {
      expect(html).toContain(`<p class="sidebar__heading">${module.title}</p>`);
    }
    expect(html).not.toContain('sidebar__module');
  });
});

describe('routes', () => {
  test.each(allPages)('$path renders the "$label" page', (page) => {
    const html = renderAt(addressOf(page));

    expect(html).toContain(`<h1 class="page-header__title">${escapeHtml(page.label)}</h1>`);
  });

  test.each(allPages)('$path highlights exactly one sidebar link', (page) => {
    const html = renderAt(addressOf(page));
    const currentLinks = html.match(/<a [^>]*aria-current="page"[^>]*>/g) ?? [];

    expect(currentLinks).toHaveLength(1);
    expect(currentLinks[0]).toContain(`href="${page.navParent ?? page.path}"`);
  });

  test('the sidebar links to every sidebar page', () => {
    const html = renderAt('/dashboard');

    for (const page of allPages.filter((p) => p.nav)) {
      expect(html, page.path).toContain(`href="${page.path}"`);
    }
  });

  test('an unknown address shows the not-found page inside the layout', () => {
    const html = renderAt('/no-such-page');

    expect(html).toContain('Page not found');
    expect(html).toContain('aria-label="Main"');
  });
});

describe('no data is shown before features are connected', () => {
  test.each(allPages.filter((page) => page.path !== '/admin/system-status'))(
    '$path has no table rows with data',
    (page) => {
      const html = renderAt(addressOf(page));
      const bodyRows = html.match(/<tbody>.*?<\/tbody>/gs) ?? [];

      for (const body of bodyRows) {
        expect(body).toContain('data-table__empty');
      }
    },
  );

  test('the dashboard shows "--" for all ten metrics', () => {
    const html = renderAt('/dashboard');
    const values = [...html.matchAll(/<p class="stat-card__value">(.*?)<\/p>/g)].map(
      (match) => match[1],
    );

    expect(values).toHaveLength(10);
    expect(values.every((value) => value === '--')).toBe(true);
  });
});

describe('module rules visible in the UI', () => {
  test('offer screens have no salary field and say why', () => {
    for (const path of ['/offers', '/offers/new', '/offers/1', '/offers/1/edit']) {
      const html = renderAt(path);
      const controls = html.match(/<(input|select|textarea) [^>]*>/g) ?? [];

      expect(
        controls.some((control) => /salary/i.test(control)),
        path,
      ).toBe(false);
      expect(html.match(/<th [^>]*>[^<]*salary/i), path).toBeNull();
    }
    expect(renderAt('/offers/new')).toContain(
      'Salary functionality pending mentor approval and authorization design.',
    );
  });

  test('the lifecycle timeline follows the task guide order', () => {
    const html = renderAt('/employees/1/lifecycle');
    const steps = [...html.matchAll(/<span class="timeline__label">(.*?)<\/span>/g)].map(
      (match) => match[1],
    );

    expect(steps).toEqual(['Joined', 'Evaluation', 'Probation', 'Junior', 'Senior']);
    expect(html).toContain('MENTOR CONFIRMATION REQUIRED');
  });

  test('a phase page highlights its own step', () => {
    const html = renderAt('/employees/phase/junior');
    const current = html.match(/<li [^>]*aria-current="step"[^>]*>.*?<\/li>/s);

    expect(current[0]).toContain('Junior');
  });

  test('the notifications page states the confirmed sending rule', () => {
    expect(renderAt('/notifications')).toContain('send_at &lt;= current time AND sent_at IS NULL');
  });
});

describe('header', () => {
  test('shows the signed-in user and a Logout button', () => {
    const html = renderAt('/dashboard');

    expect(html).toContain('Test User');
    expect(html).toContain('test.user@example.test');
    expect(html).not.toContain('Development User');
    expect(html).toMatch(/<button[^>]*>Logout<\/button>/);
  });

  test('the sidebar ends with Logout, after Administration', () => {
    const html = renderAt('/dashboard');
    const order = ['>Dashboard<', '>Reports<', '>Administration<', 'sidebar__logout'].map((text) =>
      html.indexOf(text),
    );

    expect(order.every((position) => position > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

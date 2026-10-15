import { matchPath } from 'react-router';
import { candidatesModule } from './modules/candidates/index.js';
import { employeesModule } from './modules/employees/index.js';
import { interviewsModule } from './modules/interviews/index.js';
import { notificationsModule } from './modules/notifications/index.js';
import { offersModule } from './modules/offers/index.js';
import { phoneInterviewsModule } from './modules/phone-interviews/index.js';
import DashboardPage from './pages/DashboardPage.jsx';
import LookupsPage from './pages/LookupsPage.jsx';
import AuditLogPage from './pages/AuditLogPage.jsx';
import CompanyAccountsPage from './pages/CompanyAccountsPage.jsx';
import TeamLeadsPage from './pages/TeamLeadsPage.jsx';
import ReportsPage from './modules/reports/ReportsPage.jsx';
import RolesPage from './pages/RolesPage.jsx';
import SettingsPage from './pages/SettingsPage.jsx';
import UsersPage from './pages/UsersPage.jsx';
import SystemStatusPage from './pages/SystemStatusPage.jsx';

// The six official modules, in order. Each module folder declares its own pages.
export const modules = [
  candidatesModule,
  phoneInterviewsModule,
  interviewsModule,
  offersModule,
  employeesModule,
  notificationsModule,
];

// Everything the application can show. The sidebar and the routes are both
// built from this list, so a page added to a module appears in both.
//
// A page has: path, label, description, component, and either `nav: true`
// (shown in the sidebar) or `navParent` (the sidebar link to highlight).
export const sections = [
  {
    pages: [
      {
        path: '/dashboard',
        label: 'Dashboard',
        description: 'Recruitment and employee figures at a glance.',
        component: DashboardPage,
        nav: true,
      },
    ],
  },
  ...modules.map((module) => ({
    moduleNumber: module.number,
    title: module.title,
    pages: module.pages,
  })),
  {
    pages: [
      {
        path: '/reports',
        label: 'Reports',
        description: 'Recruitment and employee reports. Exports come later.',
        component: ReportsPage,
        nav: true,
      },
    ],
  },
  {
    title: 'Administration',
    pages: [
      {
        path: '/admin/users',
        label: 'Users',
        description: 'People who can sign in.',
        component: UsersPage,
        nav: true,
      },
      {
        path: '/admin/roles',
        label: 'Roles & Permissions',
        description: 'What each role is allowed to see and do.',
        component: RolesPage,
        nav: true,
      },
      {
        path: '/admin/team-leads',
        label: 'Team Leads',
        description: 'Which Team Lead belongs to which position.',
        component: TeamLeadsPage,
        nav: true,
      },
      {
        path: '/admin/company-accounts',
        label: 'Company Accounts',
        description: 'Company email accounts: requested, created, handed over, disabled.',
        component: CompanyAccountsPage,
        nav: true,
      },
      {
        path: '/admin/lookups',
        label: 'Positions & Sources',
        description: 'The approved lists used in the Applied Position and Source dropdowns.',
        component: LookupsPage,
        nav: true,
      },
      {
        path: '/admin/settings',
        label: 'Settings',
        description: 'Phase durations and other application settings.',
        component: SettingsPage,
        nav: true,
      },
      {
        path: '/admin/audit-log',
        label: 'Audit Log',
        description: 'Who changed what, and when.',
        component: AuditLogPage,
        nav: true,
      },
      {
        path: '/admin/system-status',
        label: 'System Status',
        description: 'Development check that the frontend, backend and database are working.',
        component: SystemStatusPage,
        nav: true,
      },
    ],
  },
];

// Which permission shows a page in the sidebar (any one is enough). This only
// tidies the menu: the server refuses every request the user may not make,
// and a page opened by address still shows the server's refusal. A page not
// listed here is always shown.
const MENU_PERMISSIONS = [
  ['/admin/company-accounts', ['company_accounts.manage']],
  ['/admin/system-status', null],
  ['/admin', ['admin.manage']],
  ['/candidates', ['candidates.view', 'candidates.view_team']],
  ['/interviews', ['candidates.view', 'candidates.view_team']],
  ['/phone-interviews', ['candidates.view']],
  ['/offers', ['candidates.view']],
  ['/employees', ['candidates.view']],
  ['/notifications', ['candidates.view']],
  ['/email-templates', ['candidates.view']],
  ['/email-log', ['candidates.view']],
  ['/reports', ['candidates.view']],
  ['/dashboard', ['candidates.view']],
];

export function isInMenuFor(path, permissions) {
  if (!permissions) return true;
  const rule = MENU_PERMISSIONS.find(
    ([prefix]) => path === prefix || path.startsWith(`${prefix}/`),
  );
  if (!rule || rule[1] === null) return true;
  return rule[1].some((code) => permissions.includes(code));
}

export function sectionTitle(section) {
  if (!section.title) return null;
  return section.moduleNumber ? `Module ${section.moduleNumber} – ${section.title}` : section.title;
}

export const allPages = sections.flatMap((section) =>
  section.pages.map((page) => ({ ...page, section: sectionTitle(section) })),
);

// Fixed addresses are checked before ones with a parameter, so that
// "/candidates/new" is the Add Candidate page and not candidate number "new".
const pagesByPriority = [...allPages].sort((a, b) => a.path.includes(':') - b.path.includes(':'));

export function findPage(pathname) {
  return (
    pagesByPriority.find((page) => matchPath({ path: page.path, end: true }, pathname)) ?? null
  );
}

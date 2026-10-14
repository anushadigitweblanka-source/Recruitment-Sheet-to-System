import EmployeeDetailsPage from './EmployeeDetailsPage.jsx';
import EmployeeEditPage from './EmployeeEditPage.jsx';
import EmployeeLifecyclePage from './EmployeeLifecyclePage.jsx';
import EmployeeListPage from './EmployeeListPage.jsx';
import EmployeePhasePage from './EmployeePhasePage.jsx';

// The phase pages list active employees in one phase; the exit page lists
// everyone who has left. `phase` is the timeline step to highlight.
export const employeesModule = {
  number: 5,
  title: 'Employee Lifecycle Dashboard',
  pages: [
    {
      path: '/employees',
      label: 'Employee List',
      description: 'Everyone who has joined, with their current phase.',
      component: EmployeeListPage,
      nav: true,
    },
    {
      path: '/employees/phase/evaluation',
      label: 'Evaluation',
      description: 'Employees in the 7-day evaluation.',
      component: EmployeePhasePage,
      phase: 'Evaluation',
      filter: { phase: 'evaluation', status: 'active' },
      nav: true,
    },
    {
      path: '/employees/phase/probation',
      label: 'Probation',
      description: 'Employees in probation.',
      component: EmployeePhasePage,
      phase: 'Probation',
      filter: { phase: 'probation', status: 'active' },
      nav: true,
    },
    {
      path: '/employees/phase/junior',
      label: 'Junior Stage',
      description: 'Employees in the junior phase.',
      component: EmployeePhasePage,
      phase: 'Junior',
      filter: { phase: 'junior', status: 'active' },
      nav: true,
    },
    {
      path: '/employees/phase/senior',
      label: 'Senior Stage',
      description: 'Employees in the senior phase.',
      component: EmployeePhasePage,
      phase: 'Senior',
      filter: { phase: 'senior', status: 'active' },
      nav: true,
    },
    {
      path: '/employees/phase/exits',
      label: 'Discontinued / Exit',
      description: 'Employees who were discontinued or whose employment ended.',
      component: EmployeePhasePage,
      filter: { status: 'exited' },
      nav: true,
    },
    {
      path: '/employees/:id',
      label: 'Employee Details',
      description: 'Join date, track, current phase and outcome for one employee.',
      component: EmployeeDetailsPage,
      navParent: '/employees',
    },
    {
      path: '/employees/:id/lifecycle',
      label: 'Lifecycle Timeline',
      description: 'The phases one employee has been through, with each gate decision.',
      component: EmployeeLifecyclePage,
      navParent: '/employees',
    },
    {
      path: '/employees/:id/edit',
      label: 'Edit Employee',
      description: 'Set the employee’s track.',
      component: EmployeeEditPage,
      navParent: '/employees',
    },
  ],
};

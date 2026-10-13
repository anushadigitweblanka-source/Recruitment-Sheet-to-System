import EmployeeDetailsPage from './EmployeeDetailsPage.jsx';
import EmployeeLifecyclePage from './EmployeeLifecyclePage.jsx';
import EmployeeListPage from './EmployeeListPage.jsx';
import EmployeePhasePage from './EmployeePhasePage.jsx';

export const employeesModule = {
  number: 5,
  title: 'Employee Lifecycle',
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
      nav: true,
    },
    {
      path: '/employees/phase/probation',
      label: 'Probation',
      description: 'Employees in probation.',
      component: EmployeePhasePage,
      phase: 'Probation',
      nav: true,
    },
    {
      path: '/employees/phase/junior',
      label: 'Junior Stage',
      description: 'Employees in the junior phase.',
      component: EmployeePhasePage,
      phase: 'Junior',
      nav: true,
    },
    {
      path: '/employees/phase/senior',
      label: 'Senior Stage',
      description: 'Employees in the senior phase.',
      component: EmployeePhasePage,
      phase: 'Senior',
      nav: true,
    },
    {
      path: '/employees/phase/exits',
      label: 'Discontinued / Exit',
      description: 'Employees who were discontinued or whose employment ended.',
      component: EmployeePhasePage,
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
  ],
};

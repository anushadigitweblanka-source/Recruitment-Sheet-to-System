import CandidateDetailsPage from './CandidateDetailsPage.jsx';
import CandidateDocumentsPage from './CandidateDocumentsPage.jsx';
import CandidateFormPage from './CandidateFormPage.jsx';
import CandidateListPage from './CandidateListPage.jsx';

// `nav: true` puts the page in the sidebar. `navParent` names the sidebar
// link to highlight for a page that is not in the sidebar itself.
export const candidatesModule = {
  number: 1,
  title: 'Candidate Management',
  pages: [
    {
      path: '/candidates',
      label: 'Candidate List',
      description: 'All applicants, with filters by position, source and status.',
      component: CandidateListPage,
      nav: true,
    },
    {
      path: '/candidates/new',
      label: 'Add Candidate',
      description: 'Register a new applicant.',
      component: CandidateFormPage,
      nav: true,
    },
    {
      path: '/candidates/:id',
      label: 'Candidate Details',
      description: 'Contact details, education, applied position and current status.',
      component: CandidateDetailsPage,
      navParent: '/candidates',
    },
    {
      path: '/candidates/:id/edit',
      label: 'Edit Candidate',
      description: 'Change a candidate’s details.',
      component: CandidateFormPage,
      navParent: '/candidates',
    },
    {
      path: '/candidates/:id/documents',
      label: 'CV / Documents',
      description: 'The candidate’s CV, company-format CV and other documents.',
      component: CandidateDocumentsPage,
      navParent: '/candidates',
    },
  ],
};

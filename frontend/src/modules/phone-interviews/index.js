import PhoneInterviewDetailsPage from './PhoneInterviewDetailsPage.jsx';
import PhoneInterviewFormPage from './PhoneInterviewFormPage.jsx';
import PhoneInterviewListPage from './PhoneInterviewListPage.jsx';

// The :id in these addresses is the candidate's id: a phone interview is
// always opened for a particular candidate, whether or not one exists yet.
export const phoneInterviewsModule = {
  number: 2,
  title: 'Phone Interview',
  pages: [
    {
      path: '/phone-interviews',
      label: 'Phone Interview List',
      description: 'Every candidate, with the result of their phone interview.',
      component: PhoneInterviewListPage,
      nav: true,
    },
    {
      path: '/phone-interviews/:id',
      label: 'Phone Interview Details',
      description: 'The call result, review and interview slot for one candidate.',
      component: PhoneInterviewDetailsPage,
      navParent: '/phone-interviews',
    },
    {
      path: '/phone-interviews/:id/edit',
      label: 'Phone Interview Form',
      description: 'Record the call result and the direct interview date.',
      component: PhoneInterviewFormPage,
      navParent: '/phone-interviews',
    },
  ],
};

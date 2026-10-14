import InterviewDetailsPage from './InterviewDetailsPage.jsx';
import InterviewEvaluationPage from './InterviewEvaluationPage.jsx';
import InterviewListPage from './InterviewListPage.jsx';

export const interviewsModule = {
  number: 3,
  title: 'Direct Interview',
  pages: [
    {
      path: '/interviews',
      label: 'Interview List',
      description: 'Candidates with a direct interview, or waiting for one.',
      component: InterviewListPage,
      nav: true,
    },
    {
      // Opened as /interviews/new?candidate=12 from the list.
      path: '/interviews/new',
      label: 'New Interview Evaluation',
      description: 'Score the candidate on five criteria and record the decision.',
      component: InterviewEvaluationPage,
      navParent: '/interviews',
    },
    {
      path: '/interviews/:id',
      label: 'Interview Details',
      description: 'Scores, total and decision for one interview.',
      component: InterviewDetailsPage,
      navParent: '/interviews',
    },
    {
      path: '/interviews/:id/evaluate',
      label: 'Interview Evaluation',
      description: 'Score the candidate on five criteria and record the decision.',
      component: InterviewEvaluationPage,
      navParent: '/interviews',
    },
  ],
};

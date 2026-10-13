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
      description: 'Direct interviews, scores out of 50 and decisions.',
      component: InterviewListPage,
      nav: true,
    },
    {
      path: '/interviews/:id',
      label: 'Interview Details',
      description: 'Scores, recommendation and decision for one interview.',
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

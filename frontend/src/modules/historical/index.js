import HistoricalInterviewsPage from './HistoricalInterviewsPage.jsx';

// Imported historical interview log. Read only, for the Main User and HR
// (historical.view). It is not part of the live recruitment pipeline.
export const historicalPages = [
  {
    path: '/historical-interviews',
    label: 'Historical Interviews',
    description: 'The older interview log, exactly as imported. Read only.',
    component: HistoricalInterviewsPage,
    nav: true,
  },
];

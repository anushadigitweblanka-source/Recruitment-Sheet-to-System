import OfferDetailsPage from './OfferDetailsPage.jsx';
import OfferFormPage from './OfferFormPage.jsx';
import OfferListPage from './OfferListPage.jsx';

// Salary functionality pending mentor approval and authorization design.
export const offersModule = {
  number: 4,
  title: 'Offer Management',
  pages: [
    {
      path: '/offers',
      label: 'Offer List',
      description: 'Offers, joining dates and attendance.',
      component: OfferListPage,
      nav: true,
    },
    {
      path: '/offers/new',
      label: 'Create Offer',
      description: 'Prepare an offer for a selected candidate.',
      component: OfferFormPage,
      nav: true,
    },
    {
      path: '/offers/:id',
      label: 'Offer Details',
      description: 'Position, work mode, status and joining details for one offer.',
      component: OfferDetailsPage,
      navParent: '/offers',
    },
  ],
};

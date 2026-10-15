import OfferDetailsPage from './OfferDetailsPage.jsx';
import OfferFormPage from './OfferFormPage.jsx';
import OfferListPage from './OfferListPage.jsx';

// Salary is managed separately with Main User-only authorization.
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
      // Opened as /offers/new?candidate=12 from the list, or on its own to
      // choose from the candidates waiting for an offer.
      path: '/offers/new',
      label: 'Prepare Offer',
      description: 'Prepare and complete the offer of a selected candidate.',
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
    {
      path: '/offers/:id/edit',
      label: 'Edit Offer',
      description: 'Update the offer, its status, the joining date and attendance.',
      component: OfferFormPage,
      navParent: '/offers',
    },
  ],
};

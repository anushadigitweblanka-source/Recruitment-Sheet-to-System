import EmailLogPage from './EmailLogPage.jsx';
import EmailTemplatesPage from './EmailTemplatesPage.jsx';
import NotificationsPage from './NotificationsPage.jsx';

export const notificationsModule = {
  number: 6,
  title: 'Email Notifications',
  pages: [
    {
      path: '/notifications',
      label: 'Notifications',
      description: 'Scheduled reminders and their delivery status.',
      component: NotificationsPage,
      nav: true,
    },
    {
      path: '/email-templates',
      label: 'Email Templates',
      description: 'Editable templates for the mails the system sends.',
      component: EmailTemplatesPage,
      nav: true,
    },
    {
      path: '/email-log',
      label: 'Email Log',
      description: 'Every mail the system has tried to send, with its status.',
      component: EmailLogPage,
      nav: true,
    },
  ],
};

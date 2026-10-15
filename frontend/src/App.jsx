import { Navigate, Route, Routes } from 'react-router';
import RequireAuth from './auth/RequireAuth.jsx';
import AppLayout from './layouts/AppLayout.jsx';
import { allPages } from './navigation.js';
import CompanyCvUploadPage from './pages/CompanyCvUploadPage.jsx';
import LoginPage from './pages/LoginPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

// The sign-in page is the only page open to everyone. Every other route is
// inside RequireAuth, including addresses that do not exist.
//
// The application pages come from navigation.js. Each page component receives
// its own entry as the `page` prop (label, description and any extra settings).
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      {/* A candidate has no login: the link in the invitation is the credential. */}
      <Route path="/company-cv/upload/:token" element={<CompanyCvUploadPage />} />

      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          {allPages.map((page) => {
            const Page = page.component;
            return <Route key={page.path} path={page.path} element={<Page page={page} />} />;
          })}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  );
}

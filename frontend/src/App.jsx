import { Route, Routes } from 'react-router';
import AppLayout from './layouts/AppLayout.jsx';
import { allPages } from './navigation.js';
import NotFoundPage from './pages/NotFoundPage.jsx';

// Every route comes from navigation.js. Each page component receives its own
// entry as the `page` prop (label, description and any extra settings).
export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        {allPages.map((page) => {
          const Page = page.component;
          return <Route key={page.path} path={page.path} element={<Page page={page} />} />;
        })}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

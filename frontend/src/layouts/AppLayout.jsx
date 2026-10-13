import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import Header from '../components/Header.jsx';
import Notice from '../components/Notice.jsx';
import Sidebar from '../components/Sidebar.jsx';
import { findPage } from '../navigation.js';

// The frame around every signed-in page: header on top, sidebar on the left,
// page on the right. On narrow screens the sidebar is hidden behind the menu button.
export default function AppLayout() {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const page = findPage(pathname);
  const [menuOpenFor, setMenuOpenFor] = useState(null);
  const [logoutState, setLogoutState] = useState('idle'); // 'idle' | 'working' | 'failed'

  // The menu is open only for the page it was opened on, so it closes by
  // itself when the user follows a link.
  const isMenuOpen = menuOpenFor === pathname;
  const closeMenu = () => setMenuOpenFor(null);

  useEffect(() => {
    document.title = page ? `${page.label} · Recruitment System` : 'Recruitment System';
  }, [page]);

  useEffect(() => {
    if (!isMenuOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setMenuOpenFor(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isMenuOpen]);

  // On success the auth state becomes anonymous and RequireAuth replaces this
  // whole layout with the sign-in page, so nothing more is needed here.
  async function handleLogout() {
    setLogoutState('working');
    const result = await logout();
    if (!result.ok) setLogoutState('failed');
  }

  const isLoggingOut = logoutState === 'working';

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <Header
        page={page}
        user={user}
        isMenuOpen={isMenuOpen}
        onMenuToggle={() => setMenuOpenFor(isMenuOpen ? null : pathname)}
        onLogout={handleLogout}
        isLoggingOut={isLoggingOut}
      />

      <div className="app__body">
        <Sidebar isOpen={isMenuOpen} onLogout={handleLogout} isLoggingOut={isLoggingOut} />
        {isMenuOpen && <div className="app__backdrop" onClick={closeMenu} aria-hidden="true" />}

        <main id="main-content" className="app__main" tabIndex={-1}>
          {logoutState === 'failed' && (
            <Notice title="You are still signed in">
              Signing out did not work because the server could not be reached. Try again.
            </Notice>
          )}
          <Outlet />
        </main>
      </div>
    </div>
  );
}

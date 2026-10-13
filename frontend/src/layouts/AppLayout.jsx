import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import Header from '../components/Header.jsx';
import Sidebar from '../components/Sidebar.jsx';
import { findPage } from '../navigation.js';

// The frame around every page: header on top, sidebar on the left, page on the right.
// On narrow screens the sidebar is hidden behind the menu button.
export default function AppLayout() {
  const { pathname } = useLocation();
  const page = findPage(pathname);
  const [menuOpenFor, setMenuOpenFor] = useState(null);

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

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <Header
        page={page}
        isMenuOpen={isMenuOpen}
        onMenuToggle={() => setMenuOpenFor(isMenuOpen ? null : pathname)}
      />

      <div className="app__body">
        <Sidebar isOpen={isMenuOpen} />
        {isMenuOpen && <div className="app__backdrop" onClick={closeMenu} aria-hidden="true" />}

        <main id="main-content" className="app__main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

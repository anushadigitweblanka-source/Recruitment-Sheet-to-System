import { Link, useLocation } from 'react-router';
import { findPage, sections } from '../navigation.js';

export default function Sidebar({ isOpen, onLogout, isLoggingOut }) {
  const { pathname } = useLocation();
  const currentPage = findPage(pathname);
  // A details or form page highlights the list it belongs to.
  const activePath = currentPage?.navParent ?? currentPage?.path;

  return (
    <aside id="app-sidebar" className={`sidebar${isOpen ? ' sidebar--open' : ''}`}>
      <nav aria-label="Main">
        {sections.map((section) => {
          const links = section.pages.filter((page) => page.nav);
          return (
            <div key={links[0].path} className="sidebar__section">
              {section.title && <p className="sidebar__heading">{section.title}</p>}
              <ul className="sidebar__list">
                {links.map((page) => {
                  const isActive = page.path === activePath;
                  return (
                    <li key={page.path}>
                      <Link
                        to={page.path}
                        className={`sidebar__link${isActive ? ' sidebar__link--active' : ''}`}
                        aria-current={isActive ? 'page' : undefined}
                      >
                        {page.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}

        <div className="sidebar__section sidebar__section--logout">
          <button
            type="button"
            className="sidebar__link sidebar__logout"
            onClick={onLogout}
            disabled={isLoggingOut}
          >
            Logout
          </button>
        </div>
      </nav>
    </aside>
  );
}

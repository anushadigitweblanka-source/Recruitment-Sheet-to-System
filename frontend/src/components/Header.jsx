export default function Header({ page, user, isMenuOpen, onMenuToggle, onLogout, isLoggingOut }) {
  return (
    <header className="app-header">
      <button
        type="button"
        className="app-header__menu"
        aria-controls="app-sidebar"
        aria-expanded={isMenuOpen}
        onClick={onMenuToggle}
      >
        <span className="sr-only">{isMenuOpen ? 'Close menu' : 'Open menu'}</span>
        <span className="app-header__menu-icon" aria-hidden="true" />
      </button>

      <p className="app-header__title">Recruitment System</p>

      <p className="app-header__location">
        {page?.section && <span className="app-header__section">{page.section} / </span>}
        <span>{page ? page.label : 'Page not found'}</span>
      </p>

      <div className="app-header__user">
        <span className="app-header__avatar" aria-hidden="true">
          {user.fullName.charAt(0).toUpperCase()}
        </span>
        <span className="app-header__identity">
          <span className="app-header__name">{user.fullName}</span>
          <span className="app-header__email">{user.email}</span>
        </span>
        <button type="button" className="button" onClick={onLogout} disabled={isLoggingOut}>
          Logout
        </button>
      </div>
    </header>
  );
}

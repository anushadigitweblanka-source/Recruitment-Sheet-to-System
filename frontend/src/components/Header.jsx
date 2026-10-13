export default function Header({ page, isMenuOpen, onMenuToggle }) {
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

      {/* Placeholder until sign-in is built. Not a real person. */}
      <div className="app-header__user">
        <span className="app-header__avatar" aria-hidden="true">
          D
        </span>
        <span>Development User</span>
      </div>
    </header>
  );
}

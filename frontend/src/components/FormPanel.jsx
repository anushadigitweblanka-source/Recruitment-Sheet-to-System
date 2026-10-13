import { Link } from 'react-router';

// The frame around a form. Saving is not built yet, so the form never submits
// and the Save button stays disabled.
export default function FormPanel({ cancelTo, children }) {
  return (
    <form className="panel" onSubmit={(event) => event.preventDefault()} noValidate>
      {children}
      <div className="form-actions">
        <button type="submit" className="button button--primary" disabled>
          Save
        </button>
        <Link to={cancelTo} className="button">
          Cancel
        </Link>
        <span className="form-actions__note">Saving is not connected yet.</span>
      </div>
    </form>
  );
}

import { Link } from 'react-router';

// The frame around a form.
//
// With `onSubmit` the form is connected: Save calls it, and is disabled while
// `saving` is true. Without it the feature is not built yet, so the form
// never submits and Save stays disabled.
export default function FormPanel({
  cancelTo,
  onSubmit,
  saving = false,
  saveDisabled = false,
  saveLabel = 'Save',
  actionsAlign = 'start',
  children,
}) {
  const connected = Boolean(onSubmit);

  return (
    <form
      className="panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (connected && !saving) onSubmit();
      }}
      noValidate
    >
      {children}
      <div className={`form-actions${actionsAlign === 'end' ? ' form-actions--end' : ''}`}>
        <button
          type="submit"
          className="button button--primary"
          disabled={!connected || saving || saveDisabled}
        >
          {saving ? 'Saving…' : saveLabel}
        </button>
        <Link to={cancelTo} className="button">
          Cancel
        </Link>
        {!connected && <span className="form-actions__note">Saving is not connected yet.</span>}
      </div>
    </form>
  );
}

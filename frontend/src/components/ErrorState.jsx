export default function ErrorState({ title = 'Something went wrong', message, onRetry }) {
  return (
    <div className="error-state" role="alert">
      <p className="error-state__title">{title}</p>
      {message && <p className="error-state__message">{message}</p>}
      {onRetry && (
        <button type="button" className="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

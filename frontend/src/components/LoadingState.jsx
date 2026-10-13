export default function LoadingState({ message = 'Loading…' }) {
  return (
    <div className="state-message" role="status">
      <span className="spinner" aria-hidden="true" />
      {message}
    </div>
  );
}

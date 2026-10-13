// A highlighted message. tone: 'warning' | 'info' | 'success' | 'danger'
// Pass role="alert" for a message that appears in response to an action.
export default function Notice({ tone = 'warning', title, role, children }) {
  return (
    <div className={`notice notice--${tone}`} role={role}>
      {title && <p className="notice__title">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

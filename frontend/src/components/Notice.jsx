// A highlighted message. tone: 'warning' | 'info'
export default function Notice({ tone = 'warning', title, children }) {
  return (
    <div className={`notice notice--${tone}`}>
      {title && <p className="notice__title">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

// tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'
export default function StatusBadge({ tone = 'neutral', children }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

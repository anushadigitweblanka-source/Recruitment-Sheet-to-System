// A single dashboard figure. With no value it shows "--", never a made-up number.
export default function StatCard({ label, value, hint = 'Not available yet' }) {
  const hasValue = value !== undefined && value !== null;

  return (
    <div className="stat-card">
      <p className="stat-card__label">{label}</p>
      <p className="stat-card__value">{hasValue ? value : '--'}</p>
      {!hasValue && <p className="stat-card__hint">{hint}</p>}
    </div>
  );
}

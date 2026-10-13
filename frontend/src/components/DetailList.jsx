// Shows a record as label / value pairs.
//   fields: [{ name, label }]
//   values: { [name]: value }; anything missing shows "--"
export default function DetailList({ fields, values = {} }) {
  return (
    <dl className="detail-list">
      {fields.map((field) => (
        <div key={field.name} className="detail-list__item">
          <dt>{field.label}</dt>
          <dd>{values[field.name] ?? '--'}</dd>
        </div>
      ))}
    </dl>
  );
}

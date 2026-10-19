import EmptyState from './EmptyState.jsx';

// A plain table shell.
//   columns: [{ key, label, className? }]  className styles that column's cells
//   rows:    objects with an `id` and one property per column key
// With no rows it shows the empty message inside the table, under the headings.
export default function DataTable({
  caption,
  columns,
  rows = [],
  emptyTitle = 'No records',
  emptyMessage,
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col" className={column.className}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="data-table__empty">
                <EmptyState title={emptyTitle} message={emptyMessage} />
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id}>
                {columns.map((column) => (
                  <td key={column.key} className={column.className}>
                    {row[column.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

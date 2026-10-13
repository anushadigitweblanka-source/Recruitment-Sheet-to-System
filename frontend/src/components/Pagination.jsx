// "Showing 21–40 of 57", with Previous and Next buttons.
export default function Pagination({ page, pageSize, total, onPageChange }) {
  if (total === 0) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);
  const lastPage = Math.ceil(total / pageSize);

  return (
    <nav className="pagination" aria-label="Pages">
      <p className="pagination__summary">
        Showing {first}–{last} of {total}
      </p>
      <div className="pagination__buttons">
        <button
          type="button"
          className="button"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1}
        >
          Previous
        </button>
        <span className="pagination__page">
          Page {page} of {lastPage}
        </span>
        <button
          type="button"
          className="button"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= lastPage}
        >
          Next
        </button>
      </div>
    </nav>
  );
}

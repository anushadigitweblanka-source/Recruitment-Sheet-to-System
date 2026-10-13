import { useId } from 'react';

// A row of search and filter controls above a table.
export default function FilterBar({ label = 'Filters', children }) {
  return (
    <div className="filter-bar" role="group" aria-label={label}>
      {children}
    </div>
  );
}

// One dropdown filter. `options` is [{ value, label }]; "All" is always first.
export function FilterSelect({ label, value = '', onChange, options = [], disabled = false }) {
  const id = useId();

  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <select
        id={id}
        className="field__control"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
      >
        <option value="">All</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

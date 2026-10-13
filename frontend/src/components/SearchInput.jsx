import { useId } from 'react';

export default function SearchInput({
  label,
  value = '',
  onChange,
  placeholder = 'Search',
  disabled = false,
}) {
  const id = useId();

  return (
    <div className="field field--search">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <input
        id={id}
        type="search"
        className="field__control"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
      />
    </div>
  );
}

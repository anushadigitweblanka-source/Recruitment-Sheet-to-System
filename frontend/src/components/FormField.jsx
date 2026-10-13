import { useId } from 'react';

// One labelled form control.
//   type:    'text' | 'tel' | 'email' | 'url' | 'date' | 'datetime-local' | 'number' |
//            'textarea' | 'select' | 'checkbox'
//   options: [{ value, label }] for a select
//   pending: the list of allowed values has not been approved yet, so the
//            select is shown disabled instead of with made-up values
//   wide:    takes the full row in a FormGrid
export default function FormField({
  label,
  type = 'text',
  hint,
  options = [],
  pending = false,
  wide = false,
  ...controlProps
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const hintText = pending ? 'Allowed values are not confirmed yet.' : hint;
  const described = hintText ? { 'aria-describedby': hintId } : {};
  const className = `field${wide ? ' field--wide' : ''}`;

  if (type === 'checkbox') {
    return (
      <div className={`${className} field--checkbox`}>
        <input id={id} type="checkbox" {...described} {...controlProps} />
        <label htmlFor={id}>{label}</label>
        {hintText && (
          <p id={hintId} className="field__hint">
            {hintText}
          </p>
        )}
      </div>
    );
  }

  let control;
  if (type === 'textarea') {
    control = (
      <textarea
        id={id}
        className="field__control field__control--area"
        rows={3}
        {...described}
        {...controlProps}
      />
    );
  } else if (type === 'select') {
    control = (
      <select
        id={id}
        className="field__control"
        disabled={pending}
        {...described}
        {...controlProps}
      >
        <option value="">{pending ? 'Not defined yet' : 'Select…'}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <input id={id} type={type} className="field__control" {...described} {...controlProps} />
    );
  }

  return (
    <div className={className}>
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      {control}
      {hintText && (
        <p id={hintId} className="field__hint">
          {hintText}
        </p>
      )}
    </div>
  );
}

// Lays out a list of field definitions: [{ name, label, type, ... }].
export function FormGrid({ fields }) {
  return (
    <div className="form-grid">
      {fields.map(({ name, ...field }) => (
        <FormField key={name} name={name} {...field} />
      ))}
    </div>
  );
}

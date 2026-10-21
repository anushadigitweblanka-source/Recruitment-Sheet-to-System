import { useId } from 'react';

// One labelled form control.
//   type:    'text' | 'tel' | 'email' | 'url' | 'date' | 'datetime-local' | 'number' |
//            'textarea' | 'select' | 'checkbox'
//   options: [{ value, label }] for a select
//   pending: the list of allowed values has not been approved yet, so the
//            select is shown disabled instead of with made-up values
//   error:   a message shown under the control, which is also marked invalid
//   wide:    takes the full row in a FormGrid
export default function FormField({
  label,
  type = 'text',
  hint,
  error,
  options = [],
  pending = false,
  hideEmptyOption = false,
  emptyLabel = 'Select…',
  wide = false,
  ...controlProps
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const hintText = pending ? 'Allowed values are not confirmed yet.' : hint;
  const describedBy = [hintText && hintId, error && errorId].filter(Boolean).join(' ');
  const described = {
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(error ? { 'aria-invalid': true } : {}),
  };
  const className = `field${wide ? ' field--wide' : ''}${error ? ' field--invalid' : ''}`;

  const messages = (
    <>
      {hintText && (
        <p id={hintId} className="field__hint">
          {hintText}
        </p>
      )}
      {error && (
        <p id={errorId} className="field__error">
          {error}
        </p>
      )}
    </>
  );

  if (type === 'checkbox') {
    return (
      <div className={`${className} field--checkbox`}>
        <input id={id} type="checkbox" {...described} {...controlProps} />
        <label htmlFor={id}>{label}</label>
        {messages}
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
        {!hideEmptyOption && <option value="">{pending ? 'Not defined yet' : emptyLabel}</option>}
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
        {controlProps.required && <span className="field__required"> (required)</span>}
      </label>
      {control}
      {messages}
    </div>
  );
}

// Lays out a list of field definitions: [{ name, label, type, ... }].
//
// With `values` and `onChange` the form is connected: each control shows
// values[name] and reports edits as onChange(name, newValue). `errors` maps a
// field name to its message. Without them the controls are free-standing.
export function FormGrid({ fields, values, errors = {}, onChange, disabled = false }) {
  return (
    <div className="form-grid">
      {fields.map(({ name, ...field }) => {
        const connected = values
          ? {
              value: values[name] ?? '',
              onChange: (event) => onChange(name, event.target.value),
              disabled: disabled || field.disabled,
            }
          : {};
        return <FormField key={name} name={name} error={errors[name]} {...field} {...connected} />;
      })}
    </div>
  );
}

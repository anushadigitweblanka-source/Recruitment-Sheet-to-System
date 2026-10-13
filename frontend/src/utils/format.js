// Dates are shown in the office's time zone, whatever the viewer's computer is set to.
const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'Asia/Colombo',
});

const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Colombo',
});

export function formatDate(value) {
  return value ? dateFormat.format(new Date(value)) : null;
}

export function formatDateTime(value) {
  return value ? dateTimeFormat.format(new Date(value)) : null;
}

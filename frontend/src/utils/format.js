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

// Date-and-time boxes in forms always mean office time (Asia/Colombo, which is
// UTC+05:30 all year), whatever time zone the viewer's computer is set to.
const OFFICE_OFFSET = '+05:30';
const OFFICE_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// A moment from the backend -> the "2026-11-02T10:00" text a date-time box shows.
export function toOfficeInput(value) {
  if (!value) return '';
  return new Date(new Date(value).getTime() + OFFICE_OFFSET_MS).toISOString().slice(0, 16);
}

// The text of a date-time box -> a moment with its time zone, for the backend.
export function fromOfficeInput(text) {
  return text ? `${text}:00${OFFICE_OFFSET}` : null;
}

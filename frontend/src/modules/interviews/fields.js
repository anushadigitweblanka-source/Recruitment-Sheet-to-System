import { MAX_TOTAL } from './scoring.js';

export const INTERVIEW_COLUMNS = [
  { key: 'candidate', label: 'Candidate' },
  { key: 'scheduledAt', label: 'Interview Date/Time' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'interviewer', label: 'Interviewer' },
  { key: 'total', label: `Total / ${MAX_TOTAL}` },
  { key: 'recommendation', label: 'Recommendation' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: 'Actions' },
];

export const ATTENDANCE_OPTIONS = [
  { value: 'attended', label: 'Attended' },
  { value: 'not_attended', label: 'Not Attended' },
];
export const ATTENDANCE_LABELS = { attended: 'Attended', not_attended: 'Not Attended' };

// The three decisions the task guide names for a direct interview. The guide
// calls this field "status".
export const DECISION_OPTIONS = [
  { value: 'selected', label: 'Selected' },
  { value: 'not_selected', label: 'Not Selected' },
  { value: 'on_hold', label: 'On Hold' },
];
export const DECISION_LABELS = {
  selected: 'Selected',
  not_selected: 'Not Selected',
  on_hold: 'On Hold',
};
export const DECISION_TONES = { selected: 'success', not_selected: 'danger', on_hold: 'warning' };

export const formatTotal = (total) =>
  total === null || total === undefined ? null : `${total} / ${MAX_TOTAL}`;

import { MAX_TOTAL, SCORE_CRITERIA } from './scoring.js';

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

// Attendance and Recommendation lists have not been approved yet.
export const INTERVIEW_HEADER_FIELDS = [
  { name: 'candidate', label: 'Candidate', readOnly: true },
  { name: 'scheduledAt', label: 'Interview Date/Time', type: 'datetime-local' },
  { name: 'attendance', label: 'Attendance', type: 'select', pending: true },
  { name: 'interviewer', label: 'Interviewer' },
];

// The three decisions the task guide names for a direct interview.
export const INTERVIEW_OUTCOME_FIELDS = [
  { name: 'recommendation', label: 'Recommendation', type: 'select', pending: true },
  {
    name: 'status',
    label: 'Status',
    type: 'select',
    options: [
      { value: 'selected', label: 'Selected' },
      { value: 'not_selected', label: 'Not Selected' },
      { value: 'on_hold', label: 'On Hold' },
    ],
  },
  { name: 'remarks', label: 'Remarks', type: 'textarea', wide: true },
];

export const INTERVIEW_DETAIL_FIELDS = [
  ...INTERVIEW_HEADER_FIELDS,
  ...SCORE_CRITERIA,
  { name: 'total', label: `Total / ${MAX_TOTAL}` },
  ...INTERVIEW_OUTCOME_FIELDS,
];

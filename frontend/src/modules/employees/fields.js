export const EMPLOYEE_COLUMNS = [
  { key: 'employee', label: 'Employee' },
  { key: 'candidateCode', label: 'Candidate ID' },
  { key: 'joinDate', label: 'Join Date' },
  { key: 'track', label: 'Track' },
  { key: 'currentPhase', label: 'Current Phase' },
  { key: 'phaseStart', label: 'Phase Start' },
  { key: 'phaseEnd', label: 'Phase End' },
  { key: 'outcome', label: 'Outcome' },
  { key: 'nextReview', label: 'Next Review' },
  { key: 'actions', label: 'Actions' },
];

export const PHASE_HISTORY_COLUMNS = [
  { key: 'phase', label: 'Phase' },
  { key: 'startDate', label: 'Start Date' },
  { key: 'endDate', label: 'End Date' },
  { key: 'result', label: 'Result' },
  { key: 'reason', label: 'Reason' },
  { key: 'reviewedBy', label: 'Reviewed By' },
  { key: 'reviewDoc', label: 'Review Document' },
];

// The order comes from the task guide: the 7-day evaluation comes before probation.
export const LIFECYCLE_STEPS = ['Joined', 'Evaluation', 'Probation', 'Junior', 'Senior'];

export const PHASES = ['evaluation', 'probation', 'junior', 'senior'];
export const PHASE_LABELS = {
  evaluation: 'Evaluation',
  probation: 'Probation',
  junior: 'Junior',
  senior: 'Senior',
};
export const PHASE_OPTIONS = PHASES.map((value) => ({ value, label: PHASE_LABELS[value] }));

// "Intern / Staff" from the task guide.
export const TRACK_OPTIONS = [
  { value: 'intern', label: 'Intern' },
  { value: 'staff', label: 'Staff' },
];
export const TRACK_LABELS = { intern: 'Intern', staff: 'Staff' };

// The guide's outcome. Every active employee is shown as Currently Working.
export const STATUS_LABELS = {
  active: 'Currently Working',
  discontinued: 'Discontinued',
  terminated: 'Terminated',
};
export const STATUS_TONES = { active: 'success', discontinued: 'danger', terminated: 'danger' };
export const STATUS_OPTIONS = Object.entries(STATUS_LABELS).map(([value, label]) => ({
  value,
  label,
}));

// The gate decisions named in the task guide.
export const RESULT_LABELS = { pass: 'Pass', extend: 'Extend', discontinue: 'Discontinue' };

export const JUNIOR_END_PENDING = 'Not calculated (mentor confirmation required)';

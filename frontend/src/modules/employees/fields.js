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

export const EMPLOYEE_FIELDS = [
  { name: 'employee', label: 'Employee' },
  { name: 'candidateCode', label: 'Candidate ID' },
  { name: 'joinDate', label: 'Join Date' },
  { name: 'track', label: 'Track' },
  { name: 'currentPhase', label: 'Current Phase' },
  { name: 'phaseStart', label: 'Phase Start' },
  { name: 'phaseEnd', label: 'Phase End' },
  { name: 'outcome', label: 'Outcome' },
  { name: 'nextReview', label: 'Next Review' },
];

export const PHASE_HISTORY_COLUMNS = [
  { key: 'phase', label: 'Phase' },
  { key: 'startDate', label: 'Start Date' },
  { key: 'endDate', label: 'End Date' },
  { key: 'result', label: 'Result' },
  { key: 'reviewedBy', label: 'Reviewed By' },
  { key: 'reviewDoc', label: 'Review Document' },
];

// The order comes from the task guide: the 7-day evaluation comes before probation.
export const LIFECYCLE_STEPS = ['Joined', 'Evaluation', 'Probation', 'Junior', 'Senior'];

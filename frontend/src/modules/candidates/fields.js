export const CANDIDATE_COLUMNS = [
  { key: 'candidateCode', label: 'Candidate ID' },
  { key: 'fullName', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'position', label: 'Applied Position' },
  { key: 'source', label: 'Source' },
  { key: 'stage', label: 'Current Status' },
  { key: 'createdAt', label: 'Created Date' },
  { key: 'actions', label: 'Actions' },
];

// The fields a user can fill in, as listed in the task guide. The options for
// Applied Position and Source are added by the form from the lookup lists.
export const CANDIDATE_FIELDS = [
  {
    name: 'candidateCode',
    label: 'Candidate ID',
    required: true,
    maxLength: 30,
    hint: 'Must be unique. The ID format is not confirmed yet, so type the ID to use.',
  },
  { name: 'fullName', label: 'Name', required: true, maxLength: 150 },
  {
    name: 'phone',
    label: 'Phone',
    type: 'tel',
    hint: 'Kept as text, so a leading 0 is never lost.',
  },
  { name: 'email', label: 'Email', type: 'email', maxLength: 254 },
  { name: 'address', label: 'Address', type: 'textarea', wide: true, maxLength: 500 },
  { name: 'olMaths', label: 'O/L Maths', maxLength: 50 },
  { name: 'alResult', label: 'A/L Result', maxLength: 100 },
  { name: 'alStream', label: 'A/L Stream', maxLength: 100 },
  {
    name: 'otherEducation',
    label: 'Other Education',
    type: 'textarea',
    wide: true,
    maxLength: 1000,
  },
  { name: 'positionId', label: 'Applied Position', type: 'select' },
  { name: 'sourceId', label: 'Source', type: 'select' },
  { name: 'cvUrl', label: 'CV Link', type: 'url', wide: true, maxLength: 2000 },
  { name: 'companyCvUrl', label: 'Company CV Link', type: 'url', wide: true, maxLength: 2000 },
  { name: 'hrComment', label: 'HR Comment', type: 'textarea', wide: true, maxLength: 2000 },
];

export const CANDIDATE_DETAIL_FIELDS = [
  { name: 'candidateCode', label: 'Candidate ID' },
  { name: 'fullName', label: 'Name' },
  { name: 'stage', label: 'Current Status' },
  { name: 'phone', label: 'Phone' },
  { name: 'email', label: 'Email' },
  { name: 'address', label: 'Address' },
  { name: 'olMaths', label: 'O/L Maths' },
  { name: 'alResult', label: 'A/L Result' },
  { name: 'alStream', label: 'A/L Stream' },
  { name: 'otherEducation', label: 'Other Education' },
  { name: 'position', label: 'Applied Position' },
  { name: 'source', label: 'Source' },
  { name: 'cvUrl', label: 'CV Link' },
  { name: 'companyCvUrl', label: 'Company CV Link' },
  { name: 'companyCvStatus', label: 'Company CV Status' },
  { name: 'hrComment', label: 'HR Comment' },
  { name: 'created', label: 'Created' },
  { name: 'updated', label: 'Last Updated' },
];

// The four company CV states named in the task guide.
export const COMPANY_CV_STATUS_LABELS = {
  not_sent: 'Not sent',
  sent: 'Sent',
  received: 'Received',
  overdue: 'Overdue',
};

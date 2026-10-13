export const CANDIDATE_COLUMNS = [
  { key: 'candidateCode', label: 'Candidate ID' },
  { key: 'name', label: 'Name' },
  { key: 'phone', label: 'Phone' },
  { key: 'email', label: 'Email' },
  { key: 'position', label: 'Applied Position' },
  { key: 'source', label: 'Source' },
  { key: 'status', label: 'Current Status' },
  { key: 'createdAt', label: 'Created Date' },
  { key: 'actions', label: 'Actions' },
];

// Position and source are closed lists whose values have not been approved yet.
export const CANDIDATE_FIELDS = [
  {
    name: 'candidateCode',
    label: 'Candidate ID',
    readOnly: true,
    hint: 'Assigned by the system. The ID format is not confirmed yet.',
  },
  { name: 'name', label: 'Name', required: true },
  {
    name: 'phone',
    label: 'Phone',
    type: 'tel',
    hint: 'Kept as text, so a leading 0 is never lost.',
  },
  { name: 'email', label: 'Email', type: 'email' },
  { name: 'address', label: 'Address', type: 'textarea', wide: true },
  { name: 'olMaths', label: 'O/L Maths' },
  { name: 'alResult', label: 'A/L Result' },
  { name: 'alStream', label: 'A/L Stream' },
  { name: 'otherEducation', label: 'Other Education', type: 'textarea', wide: true },
  { name: 'position', label: 'Applied Position', type: 'select', pending: true },
  { name: 'source', label: 'Source', type: 'select', pending: true },
  { name: 'cvUrl', label: 'CV Link', type: 'url', wide: true },
  { name: 'hrComment', label: 'HR Comment', type: 'textarea', wide: true },
];

export const CANDIDATE_DETAIL_FIELDS = [
  ...CANDIDATE_FIELDS,
  { name: 'companyCvUrl', label: 'Company CV Link' },
  { name: 'companyCvStatus', label: 'Company CV Status' },
  { name: 'status', label: 'Current Status' },
  { name: 'createdAt', label: 'Created Date' },
];

export const DOCUMENT_COLUMNS = [
  { key: 'kind', label: 'Document Type' },
  { key: 'filename', label: 'File Name' },
  { key: 'uploadedAt', label: 'Uploaded At' },
  { key: 'uploadedBy', label: 'Uploaded By' },
  { key: 'actions', label: 'Actions' },
];

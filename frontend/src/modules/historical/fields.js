export const NONE = '__none';

export const COLUMNS = [
  { key: 'date', label: 'Interview Date' },
  { key: 'name', label: 'Candidate Name' },
  { key: 'phone', label: 'Contact Number' },
  { key: 'source', label: 'Source' },
  { key: 'mode', label: 'Mode' },
  { key: 'position', label: 'Position' },
  { key: 'status', label: 'Original Status' },
  { key: 'remarks', label: 'Remarks' },
  { key: 'review', label: 'Review' },
  { key: 'details', label: 'Details' },
];

// Why a record needs a person's attention. None of these says the value is
// wrong, and none changes it.
export const FLAG_LABELS = {
  name_missing: 'Name missing',
  phone_missing: 'Phone missing',
  phone_unusual: 'Phone looks unusual',
  phone_shared_different_names: 'Same phone, different names',
  date_missing: 'Date missing',
  date_unrecognised: 'Date format not recognised',
  date_year_unexpected: 'Date year unexpected',
  status_missing: 'Status missing',
};

export const flagLabel = (flag) => FLAG_LABELS[flag] ?? flag;

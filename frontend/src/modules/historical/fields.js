export const NONE = '__none';

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

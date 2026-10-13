// The five scored criteria named in the task guide. Each is 0-10, total out of 50.
export const SCORE_CRITERIA = [
  { name: 'scoreTechnical', label: 'Technical' },
  { name: 'scoreAi', label: 'AI' },
  { name: 'scoreCommunication', label: 'Communication' },
  { name: 'scoreConfidence', label: 'Confidence' },
  { name: 'scoreCultureFit', label: 'Culture Fit' },
];

export const MIN_SCORE = 0;
export const MAX_SCORE = 10;
export const MAX_TOTAL = SCORE_CRITERIA.length * MAX_SCORE;

export function isValidScore(value) {
  if (value === '' || value === null || value === undefined) return false;
  const score = Number(value);
  return Number.isInteger(score) && score >= MIN_SCORE && score <= MAX_SCORE;
}

// The total exists only when all five scores are valid. A partly scored
// interview has no total, so it can never show a misleading number.
export function calculateTotal(scores) {
  const values = SCORE_CRITERIA.map((criterion) => scores[criterion.name]);
  if (!values.every(isValidScore)) return null;
  return values.reduce((sum, value) => sum + Number(value), 0);
}

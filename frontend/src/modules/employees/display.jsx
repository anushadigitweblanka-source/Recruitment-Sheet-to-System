import { Link } from 'react-router';
import DataTable from '../../components/DataTable.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';
import { formatDate, formatDateTime } from '../../utils/format.js';
import {
  JUNIOR_END_PENDING,
  PHASE_HISTORY_COLUMNS,
  PHASE_LABELS,
  RESULT_LABELS,
  STATUS_LABELS,
  STATUS_TONES,
} from './fields.js';

export const outcomeBadge = (status) => (
  <StatusBadge tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</StatusBadge>
);

// The end of the current phase: a date, or why there is none.
export function phaseEndText({ currentPhase, phaseEnd }) {
  if (phaseEnd) return formatDate(phaseEnd);
  if (currentPhase === 'senior') return 'No end date';
  if (currentPhase === 'junior') return JUNIOR_END_PENDING;
  return null;
}

// When the next gate decision is due, for an active employee.
export function nextReviewText({ status, currentPhase, nextReview }) {
  if (status !== 'active') return null;
  if (nextReview) return formatDate(nextReview);
  if (currentPhase === 'senior') return 'None';
  if (currentPhase === 'junior') return JUNIOR_END_PENDING;
  return null;
}

function toHistoryRow(phase) {
  return {
    id: phase.id,
    phase: `${PHASE_LABELS[phase.phase]}${phase.isExtension ? ' (extension)' : ''}`,
    startDate: formatDate(phase.startDate),
    endDate:
      formatDate(phase.endDate) ??
      (phase.phase === 'senior'
        ? 'No end date'
        : phase.phase === 'junior'
          ? JUNIOR_END_PENDING
          : '--'),
    result: phase.result ? (
      RESULT_LABELS[phase.result]
    ) : (
      <StatusBadge tone="info">Open</StatusBadge>
    ),
    reason: phase.resultReason ?? '--',
    reviewedBy: phase.reviewedBy ? `${phase.reviewedBy}, ${formatDateTime(phase.decidedAt)}` : '--',
    reviewDoc: phase.reviewDocUrl ? (
      <a href={phase.reviewDocUrl} target="_blank" rel="noreferrer">
        Open
      </a>
    ) : (
      '--'
    ),
  };
}

// Every phase the employee has been in, oldest first, as recorded.
export function PhaseHistoryTable({ phases }) {
  return (
    <DataTable
      caption="Phase history"
      columns={PHASE_HISTORY_COLUMNS}
      rows={phases.map(toHistoryRow)}
      emptyTitle="No phases recorded"
    />
  );
}

export const employeeLink = (id, text) => <Link to={`/employees/${id}`}>{text}</Link>;

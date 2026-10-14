import { Link } from 'react-router';
import DetailList from './DetailList.jsx';
import StatusBadge from './StatusBadge.jsx';

const FIELDS = [
  { name: 'candidateCode', label: 'Candidate ID' },
  { name: 'fullName', label: 'Candidate Name' },
  { name: 'phone', label: 'Phone' },
  { name: 'position', label: 'Applied Position' },
  { name: 'stage', label: 'Current Status' },
];

// Who a phone or direct interview is about, shown above its form and details.
export default function CandidateSummary({ candidate }) {
  return (
    <section className="panel" aria-label="Candidate">
      <DetailList
        fields={FIELDS}
        values={{
          candidateCode: <Link to={`/candidates/${candidate.id}`}>{candidate.candidateCode}</Link>,
          fullName: candidate.fullName,
          phone: candidate.phone,
          position: candidate.position,
          stage: <StatusBadge tone="info">{candidate.stage.name}</StatusBadge>,
        }}
      />
    </section>
  );
}

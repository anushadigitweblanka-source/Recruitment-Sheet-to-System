import { Link } from 'react-router';
import DetailList from '../../components/DetailList.jsx';
import StatusBadge from '../../components/StatusBadge.jsx';

const FIELDS = [
  { name: 'candidateCode', label: 'Candidate ID' },
  { name: 'fullName', label: 'Candidate Name' },
  { name: 'phone', label: 'Phone' },
  { name: 'position', label: 'Applied Position' },
  { name: 'stage', label: 'Current Status' },
];

// Who the phone interview is about, shown above the form and the details.
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

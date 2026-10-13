import { Link } from 'react-router';
import Notice from '../../components/Notice.jsx';

// Shown when the backend finds existing candidates who look like the same
// person. Nothing has been saved at this point. The user either goes back to
// check, or confirms that this really is a separate candidate.
export default function DuplicateWarning({ duplicates, saving, onConfirm, onCancel }) {
  return (
    <Notice title="This may be a duplicate. Nothing has been saved yet." role="alert">
      <p>
        {duplicates.length === 1
          ? 'An existing candidate looks like the same person:'
          : `${duplicates.length} existing candidates look like the same person:`}
      </p>
      <ul className="duplicate-list">
        {duplicates.map((match) => (
          <li key={match.id}>
            <Link to={`/candidates/${match.id}`} target="_blank" rel="noreferrer">
              {match.candidateCode} — {match.fullName}
            </Link>
            <span className="duplicate-list__detail">
              {[match.phone, match.email, match.position].filter(Boolean).join(' · ')}
            </span>
            <span className="duplicate-list__reason">Same {match.matchedOn.join(', ')}</span>
          </li>
        ))}
      </ul>
      <p>The records are never merged automatically. Open a match to compare before deciding.</p>
      <div className="notice__actions">
        <button type="button" className="button" onClick={onCancel} disabled={saving}>
          Go back and review
        </button>
        <button
          type="button"
          className="button button--primary"
          onClick={onConfirm}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save as a separate candidate'}
        </button>
      </div>
    </Notice>
  );
}

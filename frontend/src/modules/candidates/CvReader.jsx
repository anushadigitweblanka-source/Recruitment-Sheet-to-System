import { useState } from 'react';
import { Link } from 'react-router';
import Notice from '../../components/Notice.jsx';
import { extractCvFile, extractCvLink } from './api.js';
import { CANDIDATE_FIELDS } from './fields.js';

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_BYTES = 5 * 1024 * 1024;
const LABELS = Object.fromEntries(CANDIDATE_FIELDS.map((f) => [f.name, f.label]));

// Browsers do not always report a type for .docx, so the extension is used too.
function fileType(file) {
  if (file.type === PDF || file.type === DOCX) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return PDF;
  if (name.endsWith('.docx')) return DOCX;
  return null;
}

// Reads a CV (a PDF or Word file, or a direct link to one) and hands what it
// found to the form. Nothing is saved here: the details go into the form, HR
// checks them and completes the Candidate ID, and the normal Save registers
// the candidate with all its usual checks.
//
//   onFill(draft, cvUrl)    values to put into empty form fields
//   onUseValue(name, value) one value HR chose to use from the review list
export default function CvReader({ onFill, onUseValue, disabled }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(null); // null | 'file' | 'link'
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function read(kind, send) {
    setBusy(kind);
    setError(null);
    setResult(null);
    let res;
    try {
      res = await send();
    } catch {
      res = null;
    }
    setBusy(null);

    if (res?.ok) {
      setResult(res.body);
      onFill(res.body.extraction.formDraft, res.body.cvUrl);
    } else if (res?.status === 403) {
      setError('You do not have permission to read CVs.');
    } else if (res?.body?.message) {
      setError(res.body.message);
    } else {
      setError('The CV could not be read. Check your connection and try again.');
    }
  }

  function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const type = fileType(file);
    if (!type) return setError('Choose a PDF or Word (.docx) file.');
    if (file.size > MAX_BYTES) return setError('The file is larger than 5 MB.');
    read('file', () => extractCvFile(file, type));
  }

  function submitLink(event) {
    event.preventDefault();
    if (!link.trim()) return setError('Enter the CV link first.');
    read('link', () => extractCvLink(link.trim()));
  }

  const fields = result?.extraction.fields ?? {};
  const review = result?.extraction.review;

  return (
    <section className="panel" aria-labelledby="cv-reader-title">
      <h2 id="cv-reader-title" className="panel__title">
        Fill in from a CV
      </h2>
      <p className="panel__note">
        Upload a PDF or Word CV, or paste a direct https link to one. The details found are put into
        the form below for you to check. Nothing is saved until you press Save, and the CV itself is
        not stored.
      </p>

      <div className="cv-reader">
        <label className="button">
          {busy === 'file' ? 'Reading…' : 'Upload CV'}
          <input
            type="file"
            accept=".pdf,.docx,application/pdf"
            hidden
            aria-label="Upload CV"
            onChange={chooseFile}
            disabled={disabled || busy !== null}
          />
        </label>

        <form className="cv-reader__link" onSubmit={submitLink} noValidate>
          <input
            type="url"
            className="field__control"
            aria-label="CV link"
            placeholder="https://… direct link to a PDF or Word CV"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            disabled={disabled || busy !== null}
          />
          <button type="submit" className="button" disabled={disabled || busy !== null}>
            {busy === 'link' ? 'Reading…' : 'Read link'}
          </button>
        </form>
      </div>

      {busy && (
        <p role="status" className="panel__note">
          Reading the CV…
        </p>
      )}
      {error && (
        <Notice tone="danger" role="alert">
          {error} Nothing was filled in or saved.
        </Notice>
      )}

      {result && (
        <div aria-live="polite">
          {result.duplicates.length > 0 && (
            <Notice title="This person may already be a candidate" role="alert">
              <ul className="duplicate-list">
                {result.duplicates.map((match) => (
                  <li key={match.id}>
                    <Link to={`/candidates/${match.id}`} target="_blank" rel="noreferrer">
                      {match.candidateCode} — {match.fullName}
                    </Link>
                    <span className="duplicate-list__reason">
                      Same {match.matchedOn.join(', ')}
                    </span>
                  </li>
                ))}
              </ul>
              <p>Open the existing record before registering again. Nothing is merged.</p>
            </Notice>
          )}

          <Notice tone="info" title="CV read. Please check the details below.">
            {review.extracted.length > 0 && (
              <p>
                <strong>Filled in:</strong> {review.extracted.map((n) => LABELS[n]).join(', ')}.
              </p>
            )}
            {review.uncertain.length > 0 && (
              <>
                <p>
                  <strong>Please confirm:</strong>
                </p>
                <ul>
                  {review.uncertain.map((name) => {
                    const field = fields[name];
                    const options = field.alternatives ?? (field.value ? [field.value] : []);
                    return (
                      <li key={name}>
                        {LABELS[name]}: {field.note}
                        {options.map((value) => (
                          <button
                            key={value}
                            type="button"
                            className="button"
                            onClick={() => onUseValue(name, value)}
                          >
                            Use {value}
                          </button>
                        ))}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {review.unavailable.length > 0 && (
              <p>
                <strong>Not found in the CV:</strong>{' '}
                {review.unavailable.map((n) => LABELS[n]).join(', ')}. Type these in if you know
                them.
              </p>
            )}
            <p>
              <strong>Candidate ID:</strong> type it yourself. The ID format is not confirmed, so it
              is never generated.
            </p>
            {result.extraction.warnings.map((warning) => (
              <p key={warning}>{warning}</p>
            ))}
          </Notice>
        </div>
      )}
    </section>
  );
}

import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { checkCompanyCvLink, uploadCompanyCv } from '../api/stage11.js';
import Notice from '../components/Notice.jsx';

const ALLOWED = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_BYTES = 5 * 1024 * 1024;

const LINK_PROBLEMS = {
  404: 'This upload link is not valid. Please use the link from your invitation email.',
  410: 'This upload link has already been used or has expired. Please ask HR for a new one.',
};

// The page a candidate opens from the interview invitation. There is no
// sign-in: the link itself is the only credential and it can only attach one
// Company CV to the candidate it was made for. Nothing about the candidate is
// shown here.
export default function CompanyCvUploadPage() {
  const { token } = useParams();
  const [state, setState] = useState({ status: 'checking', message: null });
  const [file, setFile] = useState(null);
  const [problem, setProblem] = useState(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    checkCompanyCvLink(token)
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setState({ status: 'ready', message: null });
        else
          setState({
            status: 'blocked',
            message: LINK_PROBLEMS[res.status] ?? 'This page could not be opened. Try again later.',
          });
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            status: 'blocked',
            message: 'This page could not be opened. Try again later.',
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  function choose(event) {
    const chosen = event.target.files?.[0] ?? null;
    setProblem(null);
    if (chosen && !ALLOWED.includes(chosen.type)) {
      setFile(null);
      setProblem('Please choose a PDF or Word document.');
    } else if (chosen && chosen.size > MAX_BYTES) {
      setFile(null);
      setProblem('The file is too large (5 MB at most).');
    } else {
      setFile(chosen);
    }
  }

  async function upload() {
    setUploading(true);
    setProblem(null);
    const res = await uploadCompanyCv(token, file).catch(() => null);
    setUploading(false);
    if (res?.ok) setState({ status: 'done', message: null });
    else if (res && (res.status === 410 || res.status === 404)) {
      setState({ status: 'blocked', message: LINK_PROBLEMS[res.status] });
    } else {
      setProblem(res?.body?.message ?? 'The upload failed. Please try again.');
    }
  }

  return (
    <main className="auth-screen">
      <section className="login-card" aria-labelledby="cv-upload-title">
        <h1 id="cv-upload-title" className="login-card__title">
          Upload your Company CV
        </h1>

        {state.status === 'checking' && <p>Checking your link…</p>}
        {state.status === 'blocked' && (
          <Notice tone="danger" role="alert">
            {state.message}
          </Notice>
        )}
        {state.status === 'done' && (
          <Notice tone="success" role="status">
            Thank you. Your Company CV has been received.
          </Notice>
        )}
        {state.status === 'ready' && (
          <>
            <p>
              Fill in the Company CV template from your invitation, then upload it here as a PDF or
              Word document (5 MB at most).
            </p>
            <div className="field">
              <label htmlFor="company-cv-file" className="field__label">
                Company CV file
              </label>
              <input
                id="company-cv-file"
                className="field__control"
                type="file"
                accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={choose}
                disabled={uploading}
              />
            </div>
            {problem && (
              <Notice tone="danger" role="alert">
                {problem}
              </Notice>
            )}
            <button
              type="button"
              className="button button--primary"
              disabled={!file || uploading}
              onClick={upload}
            >
              {uploading ? 'Uploading…' : 'Upload'}
            </button>
          </>
        )}
      </section>
    </main>
  );
}

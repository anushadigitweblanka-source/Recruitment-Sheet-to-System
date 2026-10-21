import { useEffect, useRef, useState } from 'react';
import Notice from '../../components/Notice.jsx';
import { extractCvFile, extractCvLink } from './api.js';

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_BYTES = 5 * 1024 * 1024;

// Browsers do not always report a type for .docx, so the extension is used too.
function fileType(file) {
  if (file.type === PDF || file.type === DOCX) return file.type;
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf')) return PDF;
  if (name.endsWith('.docx')) return DOCX;
  return null;
}

// Only a plain https address is worth sending to the backend; the backend
// applies its own, stricter checks as well.
function isHttpsLink(value) {
  if (/\s/.test(value)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

// Reads a CV when HR chooses a file or clicks Read link - never while a link is
// merely being typed or pasted - and hands what it found to the form. Nothing is saved here: HR checks the filled form and
// presses Save.
//
//   onLink(url)       a valid CV link was supplied (fill the CV Link field)
//   onExtracted(body) the backend's answer: { extraction, duplicates, cvUrl }
//   onFailed()        a CV could not be read
//   onRemoved()       HR removed the CV that was read
export default function CvReader({ onLink, onExtracted, onFailed, onRemoved, disabled }) {
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(null); // null | 'file' | 'link'
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  // Which read is the current one. A read that is still on its way when the CV is
  // removed (or the page is left) is outdated: its answer is ignored.
  const current = useRef(0);
  // True from the moment a read starts until its answer arrives, so a quick double
  // click cannot send the same request twice before the buttons are disabled.
  const reading = useRef(false);

  useEffect(
    () => () => {
      current.current += 1;
    },
    [],
  );

  async function read(kind, send) {
    if (reading.current) return;
    reading.current = true;
    current.current += 1;
    const mine = current.current;
    setBusy(kind);
    setError(null);
    setResult(null);
    let res;
    try {
      res = await send();
    } catch {
      res = null;
    }
    reading.current = false;
    setBusy(null);
    if (mine !== current.current) return; // outdated: the CV was removed meanwhile

    if (!res?.ok) onFailed();
    if (res?.ok) {
      setResult(res.body);
      onExtracted(res.body);
    } else if (res?.status === 403) {
      setError('You do not have permission to read CVs.');
    } else if (res?.body?.message) {
      setError(res.body.message);
    } else {
      setError('The CV could not be read. Check your connection and try again.');
    }
  }

  // A file or link that is turned down before it is sent counts as a failed read.
  function refuse(message) {
    setError(message);
    setResult(null);
    onFailed();
  }

  function removeCv() {
    current.current += 1; // anything still on its way is now outdated
    setResult(null);
    setError(null);
    setLink('');
    onRemoved();
  }

  function chooseFile(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const type = fileType(file);
    if (!type) return refuse('Choose a PDF or Word (.docx) file.');
    if (file.size > MAX_BYTES) return refuse('The file is larger than 5 MB.');
    read('file', () => extractCvFile(file, type));
  }

  // Called only from the Read link button (or Enter in the link box, which presses it).
  function readLink(value) {
    if (reading.current) return;
    const url = value.trim();
    if (!url) return refuse('Enter the CV link first.');
    if (!isHttpsLink(url)) return refuse('Enter a link that starts with https://.');
    onLink(url);
    read('link', () => extractCvLink(url));
  }

  return (
    <section className="panel" aria-labelledby="cv-reader-title">
      <h2 id="cv-reader-title" className="panel__title">
        Fill in from a CV
      </h2>

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

        <form
          className="cv-reader__link"
          onSubmit={(event) => {
            event.preventDefault();
            readLink(link);
          }}
          noValidate
        >
          <input
            type="url"
            className="field__control"
            aria-label="CV link"
            placeholder="Paste an https link to a PDF, Word or web page CV"
            value={link}
            onChange={(event) => setLink(event.target.value)}
            disabled={disabled || busy !== null}
          />
          <button type="submit" className="button" disabled={disabled || busy !== null}>
            {busy === 'link' ? 'Reading…' : 'Read link'}
          </button>
        </form>
      </div>

      {result && !busy && (
        <p className="panel__note">
          <button type="button" className="button" onClick={removeCv} disabled={disabled}>
            Remove CV
          </button>
        </p>
      )}
      {busy && (
        <p role="status" className="panel__note">
          Reading the CV…
        </p>
      )}
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}

      {(result?.extraction.warnings ?? []).map((warning) => (
        <p key={warning} className="panel__note">
          {warning}
        </p>
      ))}
    </section>
  );
}

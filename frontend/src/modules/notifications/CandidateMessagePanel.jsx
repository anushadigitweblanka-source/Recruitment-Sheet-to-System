import { useState } from 'react';
import { previewMessage } from '../../api/stage11.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import FormField from '../../components/FormField.jsx';
import Notice from '../../components/Notice.jsx';

const MESSAGE_TYPE_OPTIONS = [
  { value: 'interview_invitation', label: 'Interview invitation' },
  { value: 'joining_onboarding', label: 'Joining information' },
];

// Copies text with the clipboard API, falling back to a selected textarea for
// browsers or pages where the API is unavailable.
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const done = document.execCommand('copy');
      document.body.removeChild(area);
      return done;
    } catch {
      return false;
    }
  }
}

// The guide's "WhatsApp/SMS text with the same details": preview the text,
// then copy it. Nothing is sent from here and there is no messaging provider;
// HR pastes the text into WhatsApp or an SMS tool themselves.
export default function CandidateMessagePanel({ candidateId }) {
  const { user } = useAuth();
  const [type, setType] = useState('');
  const [preview, setPreview] = useState(null);
  const [message, setMessage] = useState(null); // { tone, text }
  const [busy, setBusy] = useState(false);

  if (!user?.permissions?.includes('notifications.manage')) return null;

  function reset(nextType) {
    setType(nextType);
    setPreview(null);
    setMessage(null);
  }

  async function showPreview() {
    setBusy(true);
    setMessage(null);
    const res = await previewMessage(candidateId, type).catch(() => null);
    setBusy(false);
    if (res?.ok) setPreview(res.body);
    else {
      setPreview(null);
      setMessage({
        tone: 'danger',
        text:
          res?.status === 422
            ? Object.values(res.body.fields ?? {}).join(' ')
            : 'The message could not be prepared. Try again.',
      });
    }
  }

  async function copy() {
    const copied = await copyText(preview.text);
    setMessage(
      copied
        ? { tone: 'success', text: 'Message copied. Paste it into WhatsApp or your SMS tool.' }
        : { tone: 'danger', text: 'Copy failed. Select the text above and copy it by hand.' },
    );
  }

  return (
    <section className="panel" aria-labelledby="message-panel-title">
      <h2 id="message-panel-title" className="panel__title">
        WhatsApp / SMS text
      </h2>
      <p className="field__hint">
        Prepare the text, check it, then copy it. Nothing is sent from this screen.
      </p>
      <FormField
        label="Message type"
        type="select"
        options={MESSAGE_TYPE_OPTIONS}
        value={type}
        onChange={(event) => reset(event.target.value)}
        disabled={busy}
      />
      <div className="form-actions">
        <button type="button" className="button" disabled={!type || busy} onClick={showPreview}>
          Preview message
        </button>
      </div>

      {message && (
        <Notice tone={message.tone} role="alert">
          {message.text}
        </Notice>
      )}

      {preview && (
        <>
          <p>
            <strong>For phone number:</strong> {preview.to || '--'}
          </p>
          {preview.missing.length > 0 ? (
            <Notice tone="warning" title="This message cannot be prepared yet">
              Missing: {preview.missing.join(', ')}.{preview.hint ? ` ${preview.hint}` : ''}
            </Notice>
          ) : (
            <FormField
              label="Message text"
              type="textarea"
              rows={5}
              value={preview.text}
              readOnly
            />
          )}
          <div className="form-actions">
            <button
              type="button"
              className="button button--primary"
              disabled={!preview.canCopy}
              onClick={copy}
            >
              Copy Message
            </button>
          </div>
        </>
      )}
    </section>
  );
}

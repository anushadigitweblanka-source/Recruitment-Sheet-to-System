import { useState } from 'react';
import { previewEmail, sendEmail } from '../../api/stage11.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import FormField from '../../components/FormField.jsx';
import Notice from '../../components/Notice.jsx';
import { MANUAL_MAIL_TYPE_OPTIONS } from './fields.js';

// What to do about each thing the server can report as missing.
const MISSING_HELP = {
  'candidate email': 'Add the candidate’s email address in Edit Candidate.',
  'interview date and time':
    'Record the phone interview as Selected with an interview date and time first.',
  'team lead for the candidate position':
    'Choose a Team Lead for this position under Administration → Team Leads.',
  'joining date': 'Record the Onboarding Date in the candidate’s offer.',
  'candidate status Rejected or On Hold':
    'Set the candidate’s status to Rejected or On Hold first.',
};

// One-click mail from a candidate's page: pick the mail, preview it, edit this
// one copy if needed, send. The server blocks a send when the candidate's
// email, the interview date or the Team Lead is missing, and refuses to send
// the same mail twice unless Resend is chosen. Shown only to people who may
// send mail.
export default function CandidateEmailPanel({ candidateId }) {
  const { user } = useAuth();
  const [type, setType] = useState('');
  const [preview, setPreview] = useState(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [message, setMessage] = useState(null); // { tone, text }
  const [needsResend, setNeedsResend] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!user?.permissions?.includes('notifications.manage')) return null;

  function reset(nextType) {
    setType(nextType);
    setPreview(null);
    setMessage(null);
    setNeedsResend(false);
  }

  async function showPreview() {
    setBusy(true);
    setMessage(null);
    setNeedsResend(false);
    const res = await previewEmail(candidateId, type).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setPreview(res.body);
      setSubject(res.body.subject);
      setBody(res.body.body);
    } else if (res?.status === 422) {
      setPreview(null);
      setMessage({ tone: 'danger', text: Object.values(res.body.fields ?? {}).join(' ') });
    } else {
      setMessage({ tone: 'danger', text: 'The preview could not be created. Try again.' });
    }
  }

  async function send(resend) {
    setBusy(true);
    setMessage(null);
    const res = await sendEmail(candidateId, { type, subject, body, resend }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setNeedsResend(false);
      setMessage({
        tone: res.body.delivered || res.body.simulated || res.body.pendingApproval ? 'success' : 'danger',
        text: res.body.pendingApproval
          ? 'Prepared. The Main User must approve this mail before it is sent.'
          : res.body.simulated
            ? 'Development mode: no real email was delivered. The attempt is recorded in the email log.'
          : res.body.delivered
            ? 'Mail sent and recorded in the email log.'
            : `Delivery failed${res.body.error ? `: ${res.body.error}` : ''}. It is recorded in the email log.`,
      });
    } else if (res?.status === 422) {
      const text = Object.values(res.body.fields ?? {}).join(' ');
      setMessage({ tone: 'danger', text });
      setNeedsResend(/Resend/.test(text));
    } else {
      setMessage({ tone: 'danger', text: 'The mail could not be sent. Try again.' });
    }
  }

  return (
    <section className="panel" aria-labelledby="email-panel-title">
      <h2 id="email-panel-title" className="panel__title">
        Send an email
      </h2>
      <FormField
        label="Mail type"
        type="select"
        options={MANUAL_MAIL_TYPE_OPTIONS}
        value={type}
        onChange={(event) => reset(event.target.value)}
        disabled={busy}
      />
      <div className="form-actions">
        <button type="button" className="button" disabled={!type || busy} onClick={showPreview}>
          Preview
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
            <strong>To:</strong> {preview.to.join(', ') || '--'}
            {preview.cc.length > 0 && (
              <>
                {' '}
                <strong>Cc:</strong> {preview.cc.join(', ')}
              </>
            )}
          </p>
          {preview.deliveryMode === 'development' && (
            <Notice title="Development mode">
              No email service has been approved yet, so Send does not deliver anything to the
              candidate. The attempt is only recorded in the email log.
            </Notice>
          )}
          {preview.missing.length > 0 && (
            <Notice tone="warning" title="This mail cannot be sent yet">
              Missing: {preview.missing.join(', ')}.
              <ul>
                {preview.missing.map((item) => (
                  <li key={item}>{MISSING_HELP[item] ?? `Provide: ${item}.`}</li>
                ))}
              </ul>
            </Notice>
          )}
          <FormField
            label="Subject"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            disabled={busy}
            hint="You may edit this one mail before sending. The template is not changed."
          />
          <FormField
            label="Body"
            type="textarea"
            rows={8}
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={busy}
          />
          <div className="form-actions">
            <button
              type="button"
              className="button button--primary"
              disabled={busy || !preview.canSend}
              aria-describedby={preview.canSend ? undefined : 'send-unavailable'}
              onClick={() => send(false)}
            >
              Send
            </button>
            {!preview.canSend && (
              <span className="field__hint" id="send-unavailable">
                Send is unavailable until the items above are provided.
              </span>
            )}
            {needsResend && (
              <button type="button" className="button" disabled={busy} onClick={() => send(true)}>
                Resend
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

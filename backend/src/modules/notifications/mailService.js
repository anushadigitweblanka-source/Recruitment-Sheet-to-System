// The one place the application hands a mail to for delivery. Everything
// else calls send({ to, cc, subject, body }) and never knows the provider.
//
// No mail provider has been approved and no mail credentials exist in the
// configuration, so the only adapter is the development one: it delivers
// nothing anywhere, succeeds immediately, and the attempt is recorded in
// email_log like a real one. A production adapter (SMTP or an API provider)
// is added here once the company approves one, without touching the callers.
//
// Credentials, when they arrive, come from the environment - never from code
// and never written to the log.

export function createMailService() {
  return {
    // Shown in answers and logs so nobody mistakes a simulated delivery for
    // a real one.
    mode: 'development',

    // Pretends to deliver. `to` is an array of addresses; subject and body
    // are the final text. Resolves like a provider acknowledgement would.
    async send({ to, subject }) {
      if (!Array.isArray(to) || to.length === 0) {
        throw new Error('A mail needs at least one recipient.');
      }
      if (!subject) throw new Error('A mail needs a subject.');
      return { delivered: false, simulated: true };
    },
  };
}

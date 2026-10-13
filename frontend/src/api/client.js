// All backend calls go through here. The sign-in session travels in a cookie
// the browser attaches by itself, so no token is ever handled in this code.

let onSessionEnded = null;

// The auth provider registers a function here, called when the backend says
// the session is no longer valid (for example, it expired while a page was open).
export function setSessionEndedHandler(handler) {
  onSessionEnded = handler;
}

async function request(path, options) {
  const res = await fetch(`/api${path}`, {
    ...options,
    headers: { Accept: 'application/json', ...options?.headers },
  });
  const body = await res.json().catch(() => null);

  if (res.status === 401 && !path.startsWith('/auth/')) {
    onSessionEnded?.();
  }
  return { ok: res.ok, status: res.status, body };
}

function send(method, path, data) {
  return request(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data ?? {}),
  });
}

export const apiGet = (path) => request(path);
export const apiPost = (path, data) => send('POST', path, data);
export const apiPut = (path, data) => send('PUT', path, data);
export const apiPatch = (path, data) => send('PATCH', path, data);

import { useCallback, useEffect, useState } from 'react';

// Runs a backend call when the page opens and again whenever `deps` change.
//
//   const candidate = useApi(() => getCandidate(id), [id]);
//
// status: 'loading' | 'ready' | 'not-found' | 'forbidden' | 'error'
// data:   the response body once status is 'ready'
// reload: call it to run the request again (for a "Try again" button)
export function useApi(load, deps) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', data: null });

    load()
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setState({ status: 'ready', data: res.body });
        else if (res.status === 404) setState({ status: 'not-found', data: null });
        else if (res.status === 403) setState({ status: 'forbidden', data: null });
        else setState({ status: 'error', data: null });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', data: null });
      });

    return () => {
      cancelled = true;
    };
    // `load` is a new function on every render; `deps` says when to re-run.
  }, [...deps, attempt]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, reload };
}

import { useCallback, useEffect, useRef, useState } from 'react';

// Runs a backend call when the page opens and again whenever `deps` change.
//
//   const candidate = useApi(() => getCandidate(id), [id]);
//
// status: 'loading' | 'ready' | 'not-found' | 'forbidden' | 'error'
// data:   the response body once status is 'ready'
// reload: call it to run the request again (for a "Try again" button)
//
// Options (third argument):
//   refreshOnFocus: also fetch again, quietly, when the browser tab or window
//   comes back into view. A list left open then shows what was saved meanwhile
//   (in another tab, say) without pressing F5. The list stays on screen while
//   it refreshes, and if that quiet refresh fails the data already shown is kept.
const FOCUS_REFRESH_GAP_MS = 1000;

export function useApi(load, deps, { refreshOnFocus = false } = {}) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const [attempt, setAttempt] = useState(0);
  // The newest `load` (it is a new function on every render, so it holds the
  // current filters) and a counter that lets a newer request win over an older one.
  const loadRef = useRef(load);
  loadRef.current = load;
  const newest = useRef(0);

  useEffect(() => {
    let cancelled = false;
    newest.current += 1;
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

  useEffect(() => {
    if (!refreshOnFocus) return undefined;
    let unmounted = false;
    let lastRun = 0;

    const refresh = () => {
      if (document.visibilityState === 'hidden') return;
      const now = Date.now();
      if (now - lastRun < FOCUS_REFRESH_GAP_MS) return;
      lastRun = now;
      newest.current += 1;
      const mine = newest.current;
      loadRef
        .current()
        .then((res) => {
          // Only a newer answer replaces what is shown; a failure keeps it.
          if (!unmounted && mine === newest.current && res.ok) {
            setState({ status: 'ready', data: res.body });
          }
        })
        .catch(() => {});
    };

    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      unmounted = true;
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [refreshOnFocus]);

  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  return { ...state, reload };
}

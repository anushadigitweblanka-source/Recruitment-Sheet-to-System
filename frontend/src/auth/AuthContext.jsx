import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiGet, apiPost, setSessionEndedHandler } from '../api/client.js';

// status: 'loading' (still asking the backend), 'authenticated' or 'anonymous'.
export const AuthContext = createContext(null);

const ANONYMOUS = { status: 'anonymous', user: null };

export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: 'loading', user: null });

  // On startup, ask the backend who is signed in. The answer comes from the
  // session cookie; nothing is remembered in the browser's own storage.
  useEffect(() => {
    let cancelled = false;

    function checkSession() {
      apiGet('/auth/me')
        .then((res) => {
          if (cancelled) return;
          setState(
            res.ok && res.body?.user ? { status: 'authenticated', user: res.body.user } : ANONYMOUS,
          );
        })
        .catch(() => {
          if (!cancelled) setState(ANONYMOUS);
        });
    }

    // Pressing Back or Forward can bring a whole earlier page back from the
    // browser's memory, exactly as it looked, without running any code again.
    // After signing out that would show the old signed-in page. So when a page
    // is restored this way, it is hidden at once and the session is re-checked.
    function onPageShow(event) {
      if (event.persisted) {
        setState({ status: 'loading', user: null });
        checkSession();
      }
    }

    checkSession();
    setSessionEndedHandler(() => setState(ANONYMOUS));
    window.addEventListener('pageshow', onPageShow);
    return () => {
      cancelled = true;
      setSessionEndedHandler(null);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, []);

  const login = useCallback(async (email, password) => {
    try {
      const res = await apiPost('/auth/login', { email, password });
      if (res.ok && res.body?.user) {
        setState({ status: 'authenticated', user: res.body.user });
        return { ok: true };
      }
      return { ok: false, error: res.body?.error ?? 'Sign-in failed.' };
    } catch {
      return { ok: false, error: 'The server could not be reached. Try again in a moment.' };
    }
  }, []);

  // Signs out on the server first. The page only forgets the user once the
  // server has confirmed the session is gone.
  const logout = useCallback(async () => {
    try {
      const res = await apiPost('/auth/logout');
      if (!res.ok) return { ok: false };
    } catch {
      return { ok: false };
    }
    setState(ANONYMOUS);
    return { ok: true };
  }, []);

  const value = useMemo(() => ({ ...state, login, logout }), [state, login, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside an AuthProvider');
  return value;
}

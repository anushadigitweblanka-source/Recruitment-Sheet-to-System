import { Navigate, Outlet } from 'react-router';
import LoadingState from '../components/LoadingState.jsx';
import { useAuth } from './AuthContext.jsx';

// Wraps every page that needs a signed-in user. Nothing inside is rendered
// until the backend has confirmed who is signed in, so protected content never
// flashes on screen first.
//
// This only controls what the page shows. The backend checks the session
// again on every request, which is the real protection.
export default function RequireAuth() {
  const { status } = useAuth();

  if (status === 'loading') {
    return (
      <div className="auth-screen">
        <LoadingState message="Checking your sign-in…" />
      </div>
    );
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}

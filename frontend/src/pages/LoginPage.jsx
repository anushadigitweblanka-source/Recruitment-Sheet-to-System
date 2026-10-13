import { useEffect, useId, useState } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from '../auth/AuthContext.jsx';
import LoadingState from '../components/LoadingState.jsx';

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function validate(email, password) {
  if (!email.trim()) return 'Enter your email address.';
  if (!EMAIL_SHAPE.test(email.trim())) return 'Enter a valid email address.';
  if (!password) return 'Enter your password.';
  return null;
}

export default function LoginPage() {
  const { status, login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const emailId = useId();
  const passwordId = useId();
  const errorId = useId();

  useEffect(() => {
    document.title = 'Sign in · Recruitment Sheet to System';
  }, []);

  if (status === 'authenticated') {
    return <Navigate to="/dashboard" replace />;
  }
  if (status === 'loading') {
    return (
      <div className="auth-screen">
        <LoadingState message="Checking your sign-in…" />
      </div>
    );
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const problem = validate(email, password);
    if (problem) {
      setError(problem);
      return;
    }

    setError(null);
    setSubmitting(true);
    const result = await login(email.trim(), password);
    // On success the page is replaced by the dashboard, so only failure is handled here.
    if (!result.ok) {
      setSubmitting(false);
      setPassword('');
      setError(result.error);
    }
  }

  return (
    <main className="auth-screen">
      <form className="login-card" onSubmit={handleSubmit} noValidate>
        <h1 className="login-card__title">Recruitment Sheet to System</h1>
        <p className="login-card__subtitle">Sign in to continue</p>

        {error && (
          <p id={errorId} className="login-card__error" role="alert">
            {error}
          </p>
        )}

        <div className="field">
          <label htmlFor={emailId} className="field__label">
            Email
          </label>
          <input
            id={emailId}
            type="email"
            name="email"
            className="field__control"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-describedby={error ? errorId : undefined}
            disabled={submitting}
            required
          />
        </div>

        <div className="field">
          <label htmlFor={passwordId} className="field__label">
            Password
          </label>
          <div className="login-card__password">
            <input
              id={passwordId}
              type={showPassword ? 'text' : 'password'}
              name="password"
              className="field__control"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-describedby={error ? errorId : undefined}
              disabled={submitting}
              required
            />
            <button
              type="button"
              className="button"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <button
          type="submit"
          className="button button--primary login-card__submit"
          disabled={submitting}
        >
          {submitting ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
    </main>
  );
}

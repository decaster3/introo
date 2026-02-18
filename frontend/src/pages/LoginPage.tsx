import { useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useAppState, useAppActions } from '../store';

export function LoginPage() {
  const { isAuthenticated, isLoading } = useAppState();
  const { login } = useAppActions();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      navigate('/home');
    }
  }, [isAuthenticated, isLoading, navigate]);

  if (isLoading) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="loading-spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">
          <span className="logo-icon">🔗</span>
          <h1>Introo</h1>
        </div>
        <p className="login-tagline">Your professional network, supercharged</p>
        
        {error === 'invite_required' ? (
          <div className="login-invite-required">
            <div className="login-invite-icon">🔒</div>
            <strong>Invite required</strong>
            <p>Introo is invite-only. You need an invite from someone already on the platform before you can sign up.</p>
            <p>Ask a colleague or friend to send you an invite from their Introo account.</p>
          </div>
        ) : error ? (
          <div className="login-error">
            Authentication failed. Please try again.
          </div>
        ) : null}

        <button className="google-login-btn" onClick={login}>
          <svg viewBox="0 0 24 24" className="google-icon">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </button>

        <p className="login-note">
          {error === 'invite_required'
            ? 'Already received an invite? Sign in with the same email it was sent to.'
            : 'Invite-only — sign in if you\'ve received an invite from an existing user.'}
        </p>

        <div className="login-legal">
          <Link to="/terms">Terms of Use</Link>
          <span>·</span>
          <Link to="/privacy">Privacy Policy</Link>
        </div>
      </div>
    </div>
  );
}

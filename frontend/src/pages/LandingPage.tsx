import { useNavigate, Link } from 'react-router-dom';
import { useEffect } from 'react';
import { useAppState } from '../store';

export function LandingPage() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAppState();

  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      navigate('/home');
    }
  }, [isAuthenticated, isLoading, navigate]);

  const handleGetStarted = () => {
    window.location.href = '/auth/google';
  };

  return (
    <div className="landing-v2">
      <nav className="nav-v2">
        <div className="nav-brand">Introo</div>
        <button className="nav-signin" onClick={handleGetStarted}>
          Sign in →
        </button>
      </nav>

      <div className="landing-main">
        <div className="landing-left">
          <h1>Share intros.<br />Grow together.</h1>
          <p>
            Join trusted communities, share your network, 
            and get warm introductions to the people you want to meet.
          </p>
          <button className="hero-btn" onClick={handleGetStarted}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Get Started
          </button>
        </div>

        <div className="landing-right">
          <div className="landing-features">
            <div className="landing-feature">
              <span className="feature-icon">👥</span>
              <div>
                <strong>Join communities</strong>
                <span>Connect with founders, investors, and peers</span>
              </div>
            </div>
            <div className="landing-feature">
              <span className="feature-icon">🤝</span>
              <div>
                <strong>Share your network</strong>
                <span>Help others with intros you can make</span>
              </div>
            </div>
            <div className="landing-feature">
              <span className="feature-icon">✨</span>
              <div>
                <strong>Get warm intros</strong>
                <span>No more cold emails — just trusted connections</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <footer className="footer-v2">
        <span>© 2026 Aspeen Inc.</span>
        <span>·</span>
        <Link to="/terms">Terms</Link>
        <span>·</span>
        <Link to="/privacy">Privacy</Link>
      </footer>
    </div>
  );
}

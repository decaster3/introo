import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './store';
import { ErrorBoundary } from './components';
import {
  LoginPage,
  OnboardingPage,
  AIHomePage,
  AdminPage,
  LandingPage,
  TermsPage,
  PrivacyPage,
  DocsPage,
} from './pages';
import './styles.css';

function App() {
  return (
    <AppProvider>
      <BrowserRouter>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/docs" element={<DocsPage />} />
          
          {/* Onboarding */}
          <Route path="/onboarding" element={<OnboardingPage />} />
          
          {/* Admin dashboard */}
          <Route path="/admin" element={<AdminPage />} />

          {/* Main app — single window */}
          <Route path="/home" element={<AIHomePage />} />

          {/* Redirect old routes to /home */}
          <Route path="/dashboard" element={<Navigate to="/home" replace />} />
          <Route path="/network" element={<Navigate to="/home" replace />} />
          <Route path="/spaces" element={<Navigate to="/home" replace />} />
          <Route path="/spaces/*" element={<Navigate to="/home" replace />} />
          <Route path="/request/*" element={<Navigate to="/home" replace />} />
          <Route path="/contact/*" element={<Navigate to="/home" replace />} />
          <Route path="/connect" element={<Navigate to="/home" replace />} />
          <Route path="/home-classic" element={<Navigate to="/home" replace />} />
          <Route path="*" element={<Navigate to="/home" replace />} />
        </Routes>
      </BrowserRouter>
    </AppProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

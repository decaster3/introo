import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AppProvider } from './store';
import { Layout, ErrorBoundary } from './components';
import {
  NewRequestPage,
  RequestDetailPage,
  LoginPage,
  OnboardingPage,
  SpacesPage,
  CreateSpacePage,
  SpaceDetailPage,
  HomePage,
  AIHomePage,
  NetworkPage,
  ContactDetailPage,
  DashboardPage,
  ConnectPage,
  LandingPage,
  TermsPage,
  PrivacyPage,
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
          
          {/* Onboarding - no layout */}
          <Route path="/onboarding" element={<OnboardingPage />} />
          
          {/* Main routes with layout */}
          <Route
            path="/home"
            element={<AIHomePage />}
          />
          {/* Keep old home page accessible */}
          <Route
            path="/home-classic"
            element={
              <Layout>
                <HomePage />
              </Layout>
            }
          />
          <Route
            path="/dashboard"
            element={
              <Layout>
                <DashboardPage />
              </Layout>
            }
          />
          <Route
            path="/network"
            element={
              <Layout>
                <NetworkPage />
              </Layout>
            }
          />
          <Route
            path="/spaces"
            element={
              <Layout>
                <SpacesPage />
              </Layout>
            }
          />
          <Route
            path="/spaces/new"
            element={
              <Layout>
                <CreateSpacePage />
              </Layout>
            }
          />
          <Route
            path="/spaces/:id"
            element={
              <Layout>
                <SpaceDetailPage />
              </Layout>
            }
          />
          <Route
            path="/request/new"
            element={
              <Layout>
                <NewRequestPage />
              </Layout>
            }
          />
          <Route
            path="/request/:id"
            element={
              <Layout>
                <RequestDetailPage />
              </Layout>
            }
          />
          <Route
            path="/contact/:id"
            element={
              <Layout>
                <ContactDetailPage />
              </Layout>
            }
          />
          <Route
            path="/connect"
            element={
              <Layout>
                <ConnectPage />
              </Layout>
            }
          />
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

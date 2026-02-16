import React, { createContext, useContext, useReducer, useEffect, useCallback, type ReactNode } from 'react';
import type { AppState, AppAction } from './types';
import { appReducer } from './reducer';
import { authApi, relationshipsApi, calendarApi } from '../lib/api';

const initialState: AppState = {
  isAuthenticated: false,
  isLoading: true,
  loadingPhase: 'init',
  currentUser: null,
  currentUserId: '',
  isCalendarConnected: false,
  contacts: [],
  companies: [],
};

interface AppContextValue {
  state: AppState;
  dispatch: React.Dispatch<AppAction>;
  login: () => void;
  logout: () => Promise<void>;
  syncCalendar: () => Promise<void>;
  refreshData: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

  // Initialize - check auth status and load data
  useEffect(() => {
    async function init() {
      try {
        dispatch({ type: 'SET_LOADING_PHASE', payload: 'init' });
        const { authenticated } = await authApi.getStatus();
        
        if (authenticated) {
          dispatch({ type: 'SET_LOADING_PHASE', payload: 'auth' });
          const { user } = await authApi.getMe();
          dispatch({
            type: 'SET_AUTH',
            payload: { isAuthenticated: true, user },
          });

          // Load essential data in parallel
          const [contactsResponse, companies, calendarStatus] = await Promise.all([
            relationshipsApi.getContacts({ limit: 10000 }).catch(() => ({ data: [] })),
            relationshipsApi.getCompanies().catch(() => []),
            calendarApi.getStatus().catch(() => ({ isConnected: false })),
          ]);

          // Extract contacts array from paginated response
          const contacts = Array.isArray(contactsResponse) 
            ? contactsResponse 
            : (contactsResponse?.data || []);

          dispatch({ type: 'SET_CONTACTS', payload: contacts });
          dispatch({ type: 'SET_COMPANIES', payload: companies });
          dispatch({ type: 'SET_CALENDAR_CONNECTED', payload: calendarStatus.isConnected });

          // Auto-sync when user has 0 contacts (first login or post-OAuth redirect)
          if (contacts.length === 0 && calendarStatus.isConnected) {
            // Calendar connected but no contacts — need to sync
            // Only clear onboarding localStorage if this is genuinely a new session
            // (no onboarding flag exists yet), not a flaky API response
            if (!localStorage.getItem('introo_onboarding_complete')) {
              const sessionKeys = [
                'introo_splash_seen',
                'introo_top_highlighted',
                'introo_tag_tip_seen',
                'introo_hunt_prompt_dismissed',
                'pods_last_enrich',
                'introo_view_mode',
              ];
              sessionKeys.forEach(k => localStorage.removeItem(k));
            }

            try {
              dispatch({ type: 'SET_LOADING_PHASE', payload: 'syncing' });
              await calendarApi.sync();
              dispatch({ type: 'SET_CALENDAR_CONNECTED', payload: true });

              const [freshContacts, freshCompanies] = await Promise.all([
                relationshipsApi.getContacts({ limit: 10000 }).catch(() => ({ data: [] })),
                relationshipsApi.getCompanies().catch(() => []),
              ]);
              const parsed = Array.isArray(freshContacts) ? freshContacts : (freshContacts?.data || []);
              dispatch({ type: 'SET_CONTACTS', payload: parsed });
              dispatch({ type: 'SET_COMPANIES', payload: freshCompanies });
            } catch (syncErr) {
              console.error('Auto calendar sync failed:', syncErr);
            }
          }

          dispatch({ type: 'SET_LOADING_PHASE', payload: 'ready' });
          dispatch({ type: 'SET_LOADING', payload: false });
        } else {
          dispatch({
            type: 'SET_AUTH',
            payload: { isAuthenticated: false, user: null },
          });
          dispatch({ type: 'SET_LOADING_PHASE', payload: null });
          dispatch({ type: 'SET_LOADING', payload: false });
        }
      } catch (error) {
        console.error('Failed to initialize:', error);
        dispatch({
          type: 'SET_AUTH',
          payload: { isAuthenticated: false, user: null },
        });
        dispatch({ type: 'SET_LOADING_PHASE', payload: null });
        dispatch({ type: 'SET_LOADING', payload: false });
      }
    }

    init();
  }, []);

  const login = useCallback(() => {
    window.location.href = authApi.getGoogleAuthUrl();
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (error) {
      console.error('Logout error:', error);
    }
    dispatch({ type: 'LOGOUT' });
    window.location.href = '/login';
  }, []);

  const syncCalendar = useCallback(async () => {
    try {
      await calendarApi.sync();
      dispatch({ type: 'SET_CALENDAR_CONNECTED', payload: true });
      
      // Refresh contacts & companies after sync
      const [contactsResponse, companies] = await Promise.all([
        relationshipsApi.getContacts({ limit: 10000 }),
        relationshipsApi.getCompanies(),
      ]);
      const contacts = Array.isArray(contactsResponse)
        ? contactsResponse
        : (contactsResponse?.data || []);
      dispatch({ type: 'SET_CONTACTS', payload: contacts });
      dispatch({ type: 'SET_COMPANIES', payload: companies });

      // Enrichment is handled by useEnrichment hook (single owner)
    } catch (error) {
      console.error('Calendar sync error:', error);
      throw error;
    }
  }, []);

  const refreshData = useCallback(async () => {
    try {
      console.log('[refreshData] Fetching contacts and companies...');
      const [contactsResponse, companies] = await Promise.all([
        relationshipsApi.getContacts({ limit: 10000 }),
        relationshipsApi.getCompanies(),
      ]);
      const contacts = Array.isArray(contactsResponse)
        ? contactsResponse
        : (contactsResponse?.data || []);
      console.log('[refreshData] Loaded', contacts.length, 'contacts,', companies.length, 'companies');
      dispatch({ type: 'SET_CONTACTS', payload: contacts });
      dispatch({ type: 'SET_COMPANIES', payload: companies });
    } catch (error) {
      console.error('Failed to refresh data:', error);
    }
  }, []);

  return (
    <AppContext.Provider value={{ state, dispatch, login, logout, syncCalendar, refreshData }}>
      {children}
    </AppContext.Provider>
  );
}

export function useAppState() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppState must be used within AppProvider');
  }
  return context.state;
}

export function useAppDispatch() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppDispatch must be used within AppProvider');
  }
  return context.dispatch;
}

export function useAppActions() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppActions must be used within AppProvider');
  }
  return {
    login: context.login,
    logout: context.logout,
    syncCalendar: context.syncCalendar,
    refreshData: context.refreshData,
  };
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within AppProvider');
  }
  return context;
}

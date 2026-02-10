import React, { createContext, useContext, useReducer, useEffect, useCallback, type ReactNode } from 'react';
import type { AppState, AppAction } from './types';
import { appReducer } from './reducer';
import { authApi, usersApi, relationshipsApi, requestsApi, offersApi, calendarApi } from '../lib/api';

const initialState: AppState = {
  isAuthenticated: false,
  isLoading: true,
  currentUser: null,
  currentUserId: '',
  isCalendarConnected: false,
  relationships: [],
  requests: [],
  offers: [],
  outcomes: [],
  users: [],
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
        const { authenticated } = await authApi.getStatus();
        
        if (authenticated) {
          const { user } = await authApi.getMe();
          dispatch({
            type: 'SET_AUTH',
            payload: { isAuthenticated: true, user },
          });

          // Load all data in parallel
          const [users, relationships, requests, offers, contactsResponse, companies, calendarStatus] = await Promise.all([
            usersApi.getAll().catch(() => []),
            relationshipsApi.getAll().catch(() => []),
            requestsApi.getAll().catch(() => []),
            offersApi.getMine().catch(() => []),
            relationshipsApi.getContacts({ limit: 1000 }).catch(() => ({ data: [] })),
            relationshipsApi.getCompanies().catch(() => []),
            calendarApi.getStatus().catch(() => ({ isConnected: false })),
          ]);

          // Extract contacts array from paginated response
          const contacts = Array.isArray(contactsResponse) 
            ? contactsResponse 
            : (contactsResponse?.data || []);

          dispatch({ type: 'SET_USERS', payload: users });
          dispatch({ type: 'SET_RELATIONSHIPS', payload: relationships });
          dispatch({ type: 'SET_REQUESTS', payload: requests });
          dispatch({ type: 'SET_OFFERS', payload: offers });
          dispatch({ type: 'SET_CONTACTS', payload: contacts });
          dispatch({ type: 'SET_COMPANIES', payload: companies });
          dispatch({ type: 'SET_CALENDAR_CONNECTED', payload: calendarStatus.isConnected });
          // All data loaded, now set loading to false
          dispatch({ type: 'SET_LOADING', payload: false });
        } else {
          dispatch({
            type: 'SET_AUTH',
            payload: { isAuthenticated: false, user: null },
          });
          dispatch({ type: 'SET_LOADING', payload: false });
        }
      } catch (error) {
        console.error('Failed to initialize:', error);
        dispatch({
          type: 'SET_AUTH',
          payload: { isAuthenticated: false, user: null },
        });
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
  }, []);

  const syncCalendar = useCallback(async () => {
    try {
      await calendarApi.sync();
      dispatch({ type: 'SET_CALENDAR_CONNECTED', payload: true });
      
      // Refresh relationships after sync
      const relationships = await relationshipsApi.getAll();
      dispatch({ type: 'SET_RELATIONSHIPS', payload: relationships });
    } catch (error) {
      console.error('Calendar sync error:', error);
      throw error;
    }
  }, []);

  const refreshData = useCallback(async () => {
    try {
      const [relationships, requests, offers] = await Promise.all([
        relationshipsApi.getAll(),
        requestsApi.getAll(),
        offersApi.getMine(),
      ]);
      dispatch({ type: 'SET_RELATIONSHIPS', payload: relationships });
      dispatch({ type: 'SET_REQUESTS', payload: requests });
      dispatch({ type: 'SET_OFFERS', payload: offers });
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

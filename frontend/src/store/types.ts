import type {
  User,
  Company,
  Contact,
} from '../types';

// Re-export for convenience
export type {
  User,
  Company,
  Contact,
};

export type LoadingPhase =
  | 'init'           // Checking authentication
  | 'auth'           // Authenticated, loading data
  | 'syncing'        // First login: syncing calendar
  | 'enriching'      // First login: enriching contacts
  | 'ready'          // Done
  | null;            // Not loading

export interface AppState {
  // Auth state
  isAuthenticated: boolean;
  isLoading: boolean;
  loadingPhase: LoadingPhase;
  currentUser: User | null;
  currentUserId: string;
  
  // App state
  isCalendarConnected: boolean;
  contacts: Contact[];
  companies: Company[];
}

export type AppAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_LOADING_PHASE'; payload: LoadingPhase }
  | { type: 'SET_AUTH'; payload: { isAuthenticated: boolean; user: User | null } }
  | { type: 'LOGOUT' }
  | { type: 'CONNECT_CALENDAR' }
  | { type: 'SET_CALENDAR_CONNECTED'; payload: boolean }
  | { type: 'SET_CONTACTS'; payload: Contact[] }
  | { type: 'ADD_CONTACT'; payload: Contact }
  | { type: 'SET_COMPANIES'; payload: Company[] }
  | { type: 'HYDRATE'; payload: AppState };

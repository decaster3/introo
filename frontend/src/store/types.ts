import type {
  User,
  Company,
  Contact,
  Meeting,
  CalendarAccount,
  IntroRequest,
  IntroRequestWithDetails,
  IntroOffer,
  IntroOutcome,
  RelationshipEdge,
} from '../types';

// Re-export for convenience
export type {
  User,
  Company,
  Contact,
  Meeting,
  CalendarAccount,
  IntroRequest,
  IntroRequestWithDetails,
  IntroOffer,
  IntroOutcome,
  RelationshipEdge,
};

export interface AppState {
  // Auth state
  isAuthenticated: boolean;
  isLoading: boolean;
  currentUser: User | null;
  currentUserId: string;
  
  // App state
  isCalendarConnected: boolean;
  relationships: RelationshipEdge[];
  requests: IntroRequestWithDetails[];
  offers: IntroOffer[];
  outcomes: IntroOutcome[];
  contacts: Contact[];
  companies: Company[];
  
  // Users for community display
  users: User[];
}

export type AppAction =
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_AUTH'; payload: { isAuthenticated: boolean; user: User | null } }
  | { type: 'LOGOUT' }
  | { type: 'SET_CURRENT_USER'; payload: string }
  | { type: 'CONNECT_CALENDAR' }
  | { type: 'SET_CALENDAR_CONNECTED'; payload: boolean }
  | { type: 'SET_RELATIONSHIPS'; payload: RelationshipEdge[] }
  | { type: 'SET_REQUESTS'; payload: IntroRequestWithDetails[] }
  | { type: 'ADD_REQUEST'; payload: IntroRequestWithDetails }
  | { type: 'UPDATE_REQUEST_STATUS'; payload: { requestId: string; status: IntroRequestWithDetails['status'] } }
  | { type: 'REMOVE_REQUEST'; payload: string }
  | { type: 'SET_OFFERS'; payload: IntroOffer[] }
  | { type: 'ADD_OFFER'; payload: IntroOffer }
  | { type: 'UPDATE_OFFER_STATUS'; payload: { offerId: string; status: IntroOffer['status'] } }
  | { type: 'SET_OUTCOME'; payload: IntroOutcome }
  | { type: 'SET_USERS'; payload: User[] }
  | { type: 'SET_CONTACTS'; payload: Contact[] }
  | { type: 'ADD_CONTACT'; payload: Contact }
  | { type: 'SET_COMPANIES'; payload: Company[] }
  | { type: 'HYDRATE'; payload: AppState };

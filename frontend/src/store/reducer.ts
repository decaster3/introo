import type { AppState, AppAction } from './types';

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };

    case 'SET_AUTH':
      return {
        ...state,
        isAuthenticated: action.payload.isAuthenticated,
        currentUser: action.payload.user,
        currentUserId: action.payload.user?.id || '',
        // Don't set isLoading: false here - wait for all data to load
      };

    case 'LOGOUT':
      return {
        ...state,
        isAuthenticated: false,
        currentUser: null,
        currentUserId: '',
        isCalendarConnected: false,
        relationships: [],
        requests: [],
        offers: [],
        contacts: [],
        companies: [],
      };

    case 'SET_CURRENT_USER':
      return { ...state, currentUserId: action.payload };

    case 'CONNECT_CALENDAR':
      return { ...state, isCalendarConnected: true };

    case 'SET_CALENDAR_CONNECTED':
      return { ...state, isCalendarConnected: action.payload };

    case 'SET_RELATIONSHIPS': {
      const payload = action.payload as any;
      const arr = Array.isArray(payload) ? payload : (payload?.data || []);
      return { ...state, relationships: arr };
    }

    case 'SET_REQUESTS': {
      const payload = action.payload as any;
      const arr = Array.isArray(payload) ? payload : (payload?.data || []);
      return { ...state, requests: arr };
    }

    case 'ADD_REQUEST':
      return { ...state, requests: [...(state.requests || []), action.payload] };

    case 'UPDATE_REQUEST_STATUS':
      return {
        ...state,
        requests: (state.requests || []).map((r) =>
          r.id === action.payload.requestId
            ? { ...r, status: action.payload.status }
            : r
        ),
      };

    case 'REMOVE_REQUEST':
      return {
        ...state,
        requests: (state.requests || []).filter((r) => r.id !== action.payload),
        offers: (state.offers || []).filter((o) => o.requestId !== action.payload),
      };

    case 'SET_OFFERS': {
      const payload = action.payload as any;
      const arr = Array.isArray(payload) ? payload : (payload?.data || []);
      return { ...state, offers: arr };
    }

    case 'ADD_OFFER':
      return { ...state, offers: [...(state.offers || []), action.payload] };

    case 'UPDATE_OFFER_STATUS':
      return {
        ...state,
        offers: (state.offers || []).map((o) =>
          o.id === action.payload.offerId
            ? { ...o, status: action.payload.status }
            : o
        ),
      };

    case 'SET_OUTCOME':
      return {
        ...state,
        outcomes: [
          ...(state.outcomes || []).filter((o) => o.requestId !== action.payload.requestId),
          action.payload,
        ],
      };

    case 'SET_USERS': {
      const payload = action.payload as any;
      const arr = Array.isArray(payload) ? payload : (payload?.data || []);
      return { ...state, users: arr };
    }

    case 'SET_CONTACTS': {
      // Handle both array and paginated response formats
      const contactsPayload = action.payload as any;
      const contactsArray = Array.isArray(contactsPayload) 
        ? contactsPayload 
        : (contactsPayload?.data || []);
      return { ...state, contacts: contactsArray };
    }

    case 'ADD_CONTACT':
      return { ...state, contacts: [...(state.contacts || []), action.payload] };

    case 'SET_COMPANIES': {
      const payload = action.payload as any;
      const arr = Array.isArray(payload) ? payload : (payload?.data || []);
      return { ...state, companies: arr };
    }

    case 'HYDRATE':
      return action.payload;

    default:
      return state;
  }
}

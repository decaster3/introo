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
      };

    case 'LOGOUT':
      return {
        ...state,
        isAuthenticated: false,
        currentUser: null,
        currentUserId: '',
        isCalendarConnected: false,
        contacts: [],
        companies: [],
      };

    case 'CONNECT_CALENDAR':
      return { ...state, isCalendarConnected: true };

    case 'SET_CALENDAR_CONNECTED':
      return { ...state, isCalendarConnected: action.payload };

    case 'SET_CONTACTS': {
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

export const API_BASE = import.meta.env.VITE_API_URL || '';

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || error.message || 'Request failed');
  }

  return response.json();
}

// Auth
export const authApi = {
  getStatus: () => request<{ authenticated: boolean }>('/auth/status'),
  getMe: () => request<{ user: User }>('/auth/me'),
  logout: () => request<{ success: boolean }>('/auth/logout', { method: 'POST' }),
  getGoogleAuthUrl: () => `${API_BASE}/auth/google`,
};

// Users
export const usersApi = {
  getAll: () => request<User[]>('/api/users'),
  getById: (id: string) => request<User>(`/api/users/${id}`),
  getMyStats: () => request<{ connections: number; asks: number; introsMade: number }>('/api/users/me/stats'),
};

// Calendar
export const calendarApi = {
  sync: () => request<{ success: boolean; contactsFound: number; companiesFound: number; relationshipsCreated: number }>('/api/calendar/sync', { method: 'POST' }),
  getStatus: () => request<{ isConnected: boolean; lastSyncedAt: string | null }>('/api/calendar/status'),
};

// Relationships
export const relationshipsApi = {
  getAll: () => request<RelationshipWithDetails[]>('/api/relationships'),
  getMine: () => request<RelationshipWithDetails[]>('/api/relationships/mine'),
  getCompanies: () => request<Company[]>('/api/relationships/companies'),
  getContacts: (options?: { limit?: number; page?: number; approved?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.limit) params.set('limit', options.limit.toString());
    if (options?.page) params.set('page', options.page.toString());
    if (options?.approved !== undefined) params.set('approved', options.approved.toString());
    const query = params.toString() ? `?${params.toString()}` : '';
    return request<{ data: Contact[]; pagination: { total: number } }>(`/api/relationships/contacts${query}`);
  },
};

// Requests
export const requestsApi = {
  getAll: () => request<IntroRequestWithDetails[]>('/api/requests'),
  getById: (id: string) => request<IntroRequestWithDetails>(`/api/requests/${id}`),
  getMine: () => request<IntroRequestWithDetails[]>('/api/requests/user/mine'),
  create: (data: CreateIntroRequest) => request<IntroRequestWithDetails>('/api/requests', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateStatus: (id: string, status: string) => request<IntroRequest>(`/api/requests/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  }),
};

// Offers
export const offersApi = {
  create: (data: { requestId: string; message: string }) => request<IntroOffer>('/api/offers', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  updateStatus: (id: string, status: 'accepted' | 'rejected') => request<IntroOffer>(`/api/offers/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  }),
  getMine: () => request<IntroOfferWithDetails[]>('/api/offers/mine'),
};

// Types
export interface User {
  id: string;
  name: string;
  avatar?: string | null;
  email?: string;
}

export interface Company {
  id: string;
  domain: string;
  name: string;
  industry?: string | null;
  sizeBucket?: string | null;
  geo?: string | null;
  logo?: string | null;
}

export interface Contact {
  id: string;
  email: string;
  name?: string | null;
  title?: string | null;
  companyId?: string | null;
  company?: Company | null;
  meetingsCount: number;
  lastSeenAt: string;
  isApproved?: boolean;
  lastEventTitle?: string;
}

export interface RelationshipWithDetails {
  id: string;
  userId: string;
  companyId: string;
  meetingsCount: number;
  lastSeenAt: string;
  strengthScore?: number | null;
  user?: User;
  company?: Company;
}

export interface NormalizedQuery {
  targetDomain?: string;
  industry?: string;
  sizeBucket?: string;
  geo?: string;
  role?: string;
}

export interface IntroRequest {
  id: string;
  requesterId: string;
  rawText: string;
  normalizedQuery: NormalizedQuery;
  bidAmount: number;
  currency: string;
  status: 'open' | 'accepted' | 'completed';
  createdAt: string;
}

export interface IntroRequestWithDetails extends IntroRequest {
  requester?: User;
  offers?: IntroOfferWithDetails[];
}

export interface IntroOffer {
  id: string;
  requestId: string;
  introducerId: string;
  message: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface IntroOfferWithDetails extends IntroOffer {
  introducer?: User;
  request?: IntroRequest & { requester?: User };
}

export interface CreateIntroRequest {
  rawText: string;
  normalizedQuery?: NormalizedQuery;
  bidAmount?: number;
  currency?: string;
}

import type {
  User,
  Company,
  Contact,
  RelationshipWithDetails,
  IntroRequest,
  IntroRequestWithDetails,
  IntroOffer,
  IntroOfferWithDetails,
  NormalizedQuery,
  CreateIntroRequest,
} from '../types';

// Re-export types for convenience
export type {
  User,
  Company,
  Contact,
  RelationshipWithDetails,
  IntroRequest,
  IntroRequestWithDetails,
  IntroOffer,
  IntroOfferWithDetails,
  NormalizedQuery,
  CreateIntroRequest,
};

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

// Spaces
export const spacesApi = {
  getAll: () => request<Space[]>('/api/spaces'),
  getById: (id: string) => request<Space>(`/api/spaces/${id}`),
  create: (data: { name: string; description?: string; emoji?: string; isPrivate?: boolean }) => 
    request<Space>('/api/spaces', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<{ success: boolean }>(`/api/spaces/${id}`, {
    method: 'DELETE',
  }),
  join: (code: string) => request<{ space: Space; membership: SpaceMember }>(`/api/spaces/join/${code}`, {
    method: 'POST',
  }),
  leave: (id: string) => request<{ success: boolean }>(`/api/spaces/${id}/leave`, {
    method: 'POST',
  }),
  getReach: (id: string) => request<SpaceReachResponse>(`/api/spaces/${id}/reach`),
  getPending: (id: string) => request<SpaceMember[]>(`/api/spaces/${id}/pending`),
  
  // Member management
  inviteMember: (spaceId: string, email: string) => request<SpaceMember>(`/api/spaces/${spaceId}/members`, {
    method: 'POST',
    body: JSON.stringify({ email }),
  }),
  approveMember: (spaceId: string, memberId: string) => request<SpaceMember>(`/api/spaces/${spaceId}/members/${memberId}/approve`, {
    method: 'POST',
  }),
  rejectMember: (spaceId: string, memberId: string) => request<{ success: boolean }>(`/api/spaces/${spaceId}/members/${memberId}/reject`, {
    method: 'POST',
  }),
  removeMember: (spaceId: string, memberId: string) => request<{ success: boolean }>(`/api/spaces/${spaceId}/members/${memberId}`, {
    method: 'DELETE',
  }),
  
  // Request management
  deleteRequest: (spaceId: string, requestId: string) => request<{ success: boolean }>(`/api/spaces/${spaceId}/requests/${requestId}`, {
    method: 'DELETE',
  }),
};

// Signals
export const signalsApi = {
  getAll: () => request<Signal[]>('/api/signals'),
  create: (data: CreateSignal) => request<Signal>('/api/signals', {
    method: 'POST',
    body: JSON.stringify(data),
  }),
  delete: (id: string) => request<{ success: boolean }>(`/api/signals/${id}`, {
    method: 'DELETE',
  }),
  toggle: (id: string, isActive: boolean) => request<Signal>(`/api/signals/${id}/toggle`, {
    method: 'POST',
    body: JSON.stringify({ isActive }),
  }),
  getMatches: () => request<SignalMatch[]>('/api/signals/matches'),
  markMatchAsRead: (matchId: string) => request<SignalMatch>(`/api/signals/matches/${matchId}/read`, {
    method: 'POST',
  }),
  markAllAsRead: () => request<{ success: boolean }>('/api/signals/matches/read-all', {
    method: 'POST',
  }),
};

// Signal types
export interface Signal {
  id: string;
  name: string;
  description?: string;
  entityType: 'contact' | 'company';
  triggerType: string;
  config: Record<string, unknown>;
  isActive: boolean;
  createdAt: string;
}

export interface CreateSignal {
  name: string;
  description?: string;
  entityType: 'contact' | 'company';
  triggerType: string;
  config?: Record<string, unknown>;
}

export interface SignalMatch {
  id: string;
  signalId: string;
  entityType: 'contact' | 'company';
  entityId: string;
  summary: string;
  data: Record<string, unknown>;
  isRead: boolean;
  matchedAt: string;
  signal: {
    id: string;
    name: string;
    entityType: string;
    triggerType: string;
  };
  entity: unknown;
}

// Additional types for API responses
export interface Space {
  id: string;
  name: string;
  description?: string | null;
  emoji: string;
  isPrivate: boolean;
  inviteCode: string;
  ownerId: string;
  members: SpaceMember[];
  requests?: SpaceRequest[];
  pendingCount?: number;
}

export interface SpaceMember {
  id: string;
  role: string;
  status?: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
  };
}

export interface SpaceRequest {
  id: string;
  requesterId: string;
  rawText: string;
  normalizedQuery: NormalizedQuery;
  bidAmount: number;
  status: string;
  createdAt: string;
  requester: {
    id: string;
    name: string;
    email: string;
    avatar: string | null;
  };
  offers: {
    id: string;
    introducerId: string;
    status: string;
    introducer: {
      id: string;
      name: string;
      avatar: string | null;
    };
  }[];
}

export interface SpaceCompany {
  id: string;
  name: string;
  domain: string;
  industry: string | null;
  sizeBucket: string | null;
  logo: string | null;
  contactCount: number;
  contacts: {
    id: string;
    name: string;
    email: string;
    title: string | null;
    userId: string;
    userName: string;
  }[];
}

export interface SpaceReachResponse {
  companies: SpaceCompany[];
  totalCompanies: number;
  totalContacts: number;
  memberCount: number;
}

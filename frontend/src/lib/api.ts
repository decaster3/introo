import type {
  User,
  Company,
  Contact,
} from '../types';

// Re-export types for convenience
export type {
  User,
  Company,
  Contact,
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

// Calendar
export const calendarApi = {
  sync: () => request<{ success: boolean; contactsFound: number; companiesFound: number; relationshipsCreated: number }>('/api/calendar/sync', { method: 'POST' }),
  getStatus: () => request<{ isConnected: boolean; lastSyncedAt: string | null }>('/api/calendar/status'),
};

// Relationships
export const relationshipsApi = {
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
};

// Enrichment
export interface EnrichmentStats {
  contacts: { total: number; enriched: number };
  companies: { total: number; enriched: number };
}

export interface EnrichmentProgress {
  total: number;
  enriched: number;
  skipped: number;
  errors: number;
  done: boolean;
}

export const enrichmentApi = {
  getStatus: () => request<EnrichmentStats>('/api/enrichment/status'),
  getProgress: () => request<{
    contacts: EnrichmentProgress | null;
    companies: EnrichmentProgress | null;
    contactsFree: EnrichmentProgress | null;
  }>('/api/enrichment/progress'),
  // FREE enrichment — uses mixed_people/api_search, 0 credits
  enrichContactsFree: () =>
    request<{ message: string; key: string }>('/api/enrichment/contacts-free', {
      method: 'POST',
    }),
};

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

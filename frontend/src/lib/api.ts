import type {
  User,
  Company,
  Contact,
  Space,
} from '../types';

// Re-export types for convenience
export type {
  User,
  Company,
  Contact,
  Space,
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
  updateProfile: (data: { name?: string; title?: string; companyDomain?: string; linkedinUrl?: string; headline?: string; city?: string; country?: string }) =>
    request<{ user: User }>('/auth/me', { method: 'PATCH', body: JSON.stringify(data) }),
  logout: () => request<{ success: boolean }>('/auth/logout', { method: 'POST' }),
  getGoogleAuthUrl: () => `${API_BASE}/auth/google`,
};

// Calendar
export interface CalendarAccountInfo {
  id: string;
  email: string;
  name: string | null;
  lastSyncedAt: string | null;
  isActive: boolean;
  contactsCount: number;
}

export const calendarApi = {
  sync: () => request<{ success: boolean; contactsFound: number; companiesFound: number; relationshipsCreated: number }>('/api/calendar/sync', { method: 'POST' }),
  getStatus: () => request<{ isConnected: boolean; lastSyncedAt: string | null; accountsCount: number }>('/api/calendar/status'),
  getAccounts: () => request<CalendarAccountInfo[]>('/api/calendar/accounts'),
  syncAccount: (id: string) => request<{ success: boolean; contactsFound: number; companiesFound: number }>(`/api/calendar/accounts/${id}/sync`, { method: 'POST' }),
  deleteAccount: (id: string) => request<{ success: boolean }>(`/api/calendar/accounts/${id}`, { method: 'DELETE' }),
  getAddAccountUrl: () => `${API_BASE}/auth/google/add-account`,
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
  error?: string | null;
}

export const enrichmentApi = {
  getStatus: () => request<EnrichmentStats>('/api/enrichment/status'),
  getProgress: () => request<{
    contacts: EnrichmentProgress | null;
    companies: EnrichmentProgress | null;
    contactsFree: EnrichmentProgress | null;
  }>('/api/enrichment/progress'),
  // Batch enrichment — paid Apollo endpoints (people/match + organizations/enrich)
  enrichContactsFree: (options?: { force?: boolean }) =>
    request<{ message: string; key: string }>('/api/enrichment/contacts-free', {
      method: 'POST',
      body: JSON.stringify({ force: options?.force ?? false }),
    }),
  stopEnrichment: () =>
    request<{ message: string; stopped: boolean; progress?: any }>('/api/enrichment/stop', {
      method: 'POST',
    }),
  lookupCompany: (domain: string) =>
    request<{ company: any; source: 'db' | 'apollo' | 'none' }>(`/api/enrichment/company/${encodeURIComponent(domain)}`),
  lookupContact: (email: string) =>
    request<{
      person: { name: string | null; title: string | null; headline: string | null; linkedinUrl: string | null; photoUrl: string | null; city: string | null; country: string | null; company: string | null; companyDomain: string | null } | null;
      company: { domain: string; name: string; industry: string | null; employeeCount: number | null; city: string | null; country: string | null; description: string | null; websiteUrl: string | null; logo: string | null; [key: string]: unknown } | null;
      email: string;
      domain: string | null;
      source: 'apollo' | 'partial' | 'none';
    }>('/api/enrichment/lookup-contact', { method: 'POST', body: JSON.stringify({ email }) }),
  addContact: (data: {
    email: string; name?: string; title?: string; linkedinUrl?: string; photoUrl?: string;
    city?: string; country?: string; companyName?: string; companyDomain?: string; websiteUrl?: string;
  }) =>
    request<{ contact: any }>('/api/enrichment/add-contact', { method: 'POST', body: JSON.stringify(data) }),
};

// Intro Requests
export const requestsApi = {
  create: (data: { rawText: string; spaceId?: string; connectionPeerId?: string; normalizedQuery?: Record<string, unknown> }) =>
    request<IntroRequestResponse>('/api/requests', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getMine: () => request<IntroRequestResponse[]>('/api/requests/user/mine'),
  getIncoming: () => request<IntroRequestResponse[]>('/api/requests/user/incoming'),
  decline: (id: string, reason?: string) =>
    request<IntroRequestResponse>(`/api/requests/${id}/decline`, {
      method: 'PATCH',
      body: JSON.stringify({ reason }),
    }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/api/requests/${id}`, {
      method: 'DELETE',
    }),
  markDone: (id: string) =>
    request<IntroRequestResponse>(`/api/requests/${id}/done`, {
      method: 'PATCH',
    }),
};

// Intro Offers
export const offersApi = {
  create: (data: { requestId: string; message?: string }) =>
    request<{ id: string; requestId: string; status: string }>('/api/offers', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// Notifications
export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
}

export const notificationsApi = {
  getAll: (unreadOnly?: boolean) =>
    request<Notification[]>(`/api/notifications${unreadOnly ? '?unreadOnly=true' : ''}`),
  getUnreadCount: () => request<{ count: number }>('/api/notifications/unread-count'),
  markAsRead: (id: string) =>
    request<Notification>(`/api/notifications/${id}/read`, { method: 'PATCH' }),
  markAllRead: () =>
    request<{ success: boolean }>('/api/notifications/mark-all-read', { method: 'POST' }),
  deleteOne: (id: string) =>
    request<{ success: boolean }>(`/api/notifications/${id}`, { method: 'DELETE' }),
  deleteAll: () =>
    request<{ success: boolean }>('/api/notifications', { method: 'DELETE' }),
};

// Tags
export const tagsApi = {
  getAll: () =>
    request<{ tagDefs: Record<string, string>; companyTags: Record<string, string[]> }>('/api/tags'),
  createTag: (name: string, color: string) =>
    request<{ tag: { name: string; color: string } }>('/api/tags', {
      method: 'POST',
      body: JSON.stringify({ name, color }),
    }),
  deleteTag: (name: string) =>
    request<{ success: boolean }>(`/api/tags/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  toggleTag: (tagName: string, companyDomain: string) =>
    request<{ action: 'added' | 'removed' }>('/api/tags/toggle', {
      method: 'POST',
      body: JSON.stringify({ tagName, companyDomain }),
    }),
  sync: (tagDefs: Record<string, string>, companyTags: Record<string, string[]>) =>
    request<{ success: boolean }>('/api/tags/sync', {
      method: 'PUT',
      body: JSON.stringify({ tagDefs, companyTags }),
    }),
};

// Views (saved filter/sort/group presets)
export interface SavedViewResponse {
  id: string;
  title: string;
  keywords: string[];
  filters: Record<string, unknown>;
  sortRules: { field: string; dir: 'asc' | 'desc' }[];
  groupBy: { field: string; dir: 'asc' | 'desc' } | null;
  position: number;
  createdAt: string;
}

export const viewsApi = {
  getAll: () => request<SavedViewResponse[]>('/api/views'),
  create: (data: { title: string; keywords?: string[]; filters?: Record<string, unknown>; sortRules?: { field: string; dir: string }[]; groupBy?: { field: string; dir: string } | null }) =>
    request<SavedViewResponse>('/api/views', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { title?: string; keywords?: string[]; filters?: Record<string, unknown>; sortRules?: { field: string; dir: string }[]; groupBy?: { field: string; dir: string } | null }) =>
    request<SavedViewResponse>(`/api/views/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/api/views/${id}`, { method: 'DELETE' }),
};

// Email
export const emailApi = {
  sendIntroOffer: (data: { recipientEmail: string; recipientName: string; targetCompany: string; contactName?: string }) =>
    request<{ success: boolean; emailId?: string }>('/api/email/intro-offer', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  sendDoubleIntro: (data: { requesterEmail: string; requesterName: string; contactEmail: string; contactName: string; targetCompany: string }) =>
    request<{ success: boolean; emailId?: string }>('/api/email/double-intro', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  sendContact: (data: { recipientEmail: string; recipientName?: string; subject: string; body: string }) =>
    request<{ success: boolean; emailId?: string }>('/api/email/contact', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getPreferences: () =>
    request<{ intros?: boolean; notifications?: boolean; digests?: boolean }>('/api/email/preferences'),
  updatePreferences: (prefs: { intros?: boolean; notifications?: boolean; digests?: boolean }) =>
    request<{ success: boolean; preferences: Record<string, boolean> }>('/api/email/preferences', {
      method: 'PATCH',
      body: JSON.stringify(prefs),
    }),
};

export interface IntroRequestResponse {
  id: string;
  requesterId: string;
  rawText: string;
  normalizedQuery: Record<string, unknown>;
  status: string;
  spaceId: string | null;
  createdAt: string;
  requester: { id: string; name: string; avatar: string | null };
  space: { id: string; name: string; emoji: string } | null;
}

// Additional types for API responses
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

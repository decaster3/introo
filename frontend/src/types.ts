// =============================================================================
// Core Entity Types
// =============================================================================

export interface User {
  id: string;
  name: string;
  email?: string;
  avatar?: string | null;
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

export interface Meeting {
  id: string;
  title: string;
  date: string;
  duration?: number;
}

// =============================================================================
// Contact Types
// =============================================================================

// Contact as returned from API and stored in state
export interface Contact {
  id: string;
  email: string;
  name?: string | null;
  title?: string | null;
  avatarUrl?: string | null;
  companyId?: string | null;
  company?: Company | null;
  meetingsCount: number;
  lastSeenAt: string;
  isApproved?: boolean;
  lastEventTitle?: string;
  meetings?: Meeting[];
  source?: string;
  sourceAccountEmail?: string;
}

// Display-friendly contact for UI components (derived from Contact)
export interface DisplayContact {
  id: string;
  name: string;
  email: string;
  avatar: string;
  title: string;
  company: string;
  companyDomain: string;
  linkedinUrl?: string;
  lastContacted: Date;
  connectionStrength: 'strong' | 'medium' | 'weak';
}

// =============================================================================
// Relationship Types
// =============================================================================

export interface RelationshipEdge {
  id?: string;
  userId: string;
  companyId: string;
  meetingsCount: number;
  lastSeenAt: string; // ISO date
  strengthScore?: number | null; // computed
  user?: User;
  company?: Company;
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

// =============================================================================
// Intro Request Types
// =============================================================================

export interface NormalizedQuery {
  targetDomain?: string;
  targetCompany?: string;
  targetRole?: string;
  industry?: string;
  sizeBucket?: string;
  geo?: string;
  role?: string;
  offer?: string;
}

export interface IntroRequest {
  id: string;
  requesterId: string;
  spaceId?: string;
  rawText: string;
  normalizedQuery: NormalizedQuery;
  bidAmount: number;
  currency: string;
  status: 'open' | 'accepted' | 'completed';
  createdAt: string;
  space?: {
    id: string;
    name: string;
    emoji: string;
  };
}

export interface IntroRequestWithDetails extends IntroRequest {
  requester?: User;
  offers?: IntroOfferWithDetails[];
}

export interface CreateIntroRequest {
  rawText: string;
  normalizedQuery?: NormalizedQuery;
  bidAmount?: number;
  currency?: string;
}

// =============================================================================
// Intro Offer Types
// =============================================================================

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

export interface IntroOutcome {
  requestId: string;
  status: 'none' | 'intro_sent';
  updatedAt: string;
}

// =============================================================================
// Matching Types
// =============================================================================

export interface MatchResult {
  userId: string;
  userName: string;
  companyId: string;
  companyDomain: string;
  companyName: string;
  finalScore: number;
  explanation: string;
}

// =============================================================================
// Calendar Types
// =============================================================================

export interface CalendarAccount {
  id: string;
  email: string;
  name?: string;
  lastSyncedAt?: string;
  isActive: boolean;
  contactsCount: number;
}

// =============================================================================
// Space Types
// =============================================================================

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

export interface Space {
  id: string;
  name: string;
  description?: string | null;
  emoji: string;
  isPrivate: boolean;
  inviteCode: string;
  ownerId: string;
  members: SpaceMember[];
}

// =============================================================================
// Utility Functions
// =============================================================================

export function calculateStrength(lastSeenAt: string, meetingsCount: number): 'strong' | 'medium' | 'weak' {
  const daysSince = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / (1000 * 60 * 60 * 24));
  if (daysSince <= 7 && meetingsCount >= 3) return 'strong';
  if (daysSince <= 30 && meetingsCount >= 2) return 'medium';
  return 'weak';
}

export function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

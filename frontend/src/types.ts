// =============================================================================
// Core Entity Types
// =============================================================================

export interface User {
  id: string;
  name: string;
  email?: string;
  avatar?: string | null;
  title?: string | null;
  company?: string | null;
  companyDomain?: string | null;
  linkedinUrl?: string | null;
  headline?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface Company {
  id: string;
  domain: string;
  name: string;
  industry?: string | null;
  sizeBucket?: string | null;
  geo?: string | null;
  logo?: string | null;
  employeeCount?: number | null;
  employeeRange?: string | null;
  foundedYear?: number | null;
  annualRevenue?: string | null;
  totalFunding?: string | null;
  lastFundingRound?: string | null;
  lastFundingDate?: string | null;
  linkedinUrl?: string | null;
  websiteUrl?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  description?: string | null;
  technologies?: string[] | null;
  enrichedAt?: string | null;
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
  sourceAccountEmails?: string[];
  linkedinUrl?: string | null;
  photoUrl?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  headline?: string | null;
  enrichedAt?: string | null;
  createdAt?: string;
  firstSeenAt?: string;
}

// =============================================================================
// App-Level Types (used across components)
// =============================================================================

export interface SpaceCompany {
  id: string;
  domain: string;
  name: string;
  industry?: string;
  contactCount: number;
  spaceId?: string;
  employeeCount?: number | null;
  foundedYear?: number | null;
  annualRevenue?: string | null;
  totalFunding?: string | null;
  lastFundingRound?: string | null;
  lastFundingDate?: string | null;
  city?: string | null;
  country?: string | null;
  description?: string | null;
  linkedinUrl?: string | null;
  enrichedAt?: string | null;
  contacts: {
    id: string; name: string; email: string; title?: string;
    userId: string; userName: string; spaceId?: string;
  }[];
}

export interface Space {
  id: string;
  name: string;
  emoji: string;
  memberCount?: number;
  openRequestCount?: number;
  description?: string | null;
  inviteCode?: string;
  ownerId?: string;
  members?: { id: string; role: string; user: { id: string; name: string; email: string; avatar: string | null } }[];
}

export interface PendingSpace {
  id: string;
  name: string;
  emoji: string;
  isPrivate: boolean;
  membershipId: string;
  appliedAt: string;
}

export interface PendingMember {
  id: string;
  userId: string;
  user: { id: string; name: string; email: string; avatar: string | null };
}

export interface DirectConnection {
  id: string;
  status: 'pending' | 'accepted' | 'rejected';
  direction: 'sent' | 'received';
  createdAt: string;
  peer: { id: string; name: string; email: string; avatar: string | null };
}

export interface ConnectionCompany {
  id: string;
  domain: string;
  name: string;
  industry?: string | null;
  contactCount: number;
  connectionId: string;
  employeeCount?: number | null;
  foundedYear?: number | null;
  annualRevenue?: string | null;
  totalFunding?: string | null;
  lastFundingRound?: string | null;
  lastFundingDate?: string | null;
  city?: string | null;
  country?: string | null;
  description?: string | null;
  linkedinUrl?: string | null;
  enrichedAt?: string | null;
  contacts: {
    id: string; name: string; email: string; title?: string;
    userId: string; userName: string; connectionId?: string;
  }[];
}

export interface DisplayContact {
  id: string; name: string; email: string; title: string;
  company: string; companyDomain: string;
  lastSeenAt: string; meetingsCount: number;
  firstSeenAt: string;
  connectionStrength: 'strong' | 'medium' | 'weak';
  linkedinUrl?: string | null;
  photoUrl?: string | null;
  city?: string | null;
  country?: string | null;
  headline?: string | null;
  enrichedAt?: string | null;
  sourceAccountEmails?: string[];
  companyData?: {
    id?: string;
    employeeCount?: number | null;
    foundedYear?: number | null;
    annualRevenue?: string | null;
    totalFunding?: string | null;
    lastFundingRound?: string | null;
    lastFundingDate?: string | null;
    city?: string | null;
    country?: string | null;
    industry?: string | null;
    description?: string | null;
    linkedinUrl?: string | null;
    enrichedAt?: string | null;
  };
}

export interface MergedCompany {
  id?: string;
  domain: string;
  name: string;
  myContacts: DisplayContact[];
  spaceContacts: { id: string; name: string; email: string; title?: string; userName: string; spaceId?: string }[];
  myCount: number;
  spaceCount: number;
  totalCount: number;
  hasStrongConnection: boolean;
  bestStrength: 'strong' | 'medium' | 'weak' | 'none';
  source: 'mine' | 'space' | 'both';
  matchingHunts: string[];
  spaceIds: string[];
  connectionIds: string[];
  employeeCount?: number | null;
  foundedYear?: number | null;
  annualRevenue?: string | null;
  totalFunding?: string | null;
  lastFundingRound?: string | null;
  lastFundingDate?: string | null;
  city?: string | null;
  country?: string | null;
  industry?: string | null;
  description?: string | null;
  linkedinUrl?: string | null;
  enrichedAt?: string | null;
}

export interface HuntFilters {
  description?: string;
  categories?: string[];
  aiKeywords?: string[];
  excludeKeywords?: string;
  employeeRanges?: string[];
  country?: string;
  city?: string;
  fundingRounds?: string[];
  fundingRecency?: string;
  foundedFrom?: string;
  foundedTo?: string;
  revenueRanges?: string[];
  technologies?: string[];
  sourceFilter?: string;
  strengthFilter?: string;
}

export interface Hunt {
  id: string;
  title: string;
  keywords: string[];
  filters?: HuntFilters;
  isActive: boolean;
}

export interface InlinePanel {
  type: 'person' | 'intro-request' | 'intro-offer' | 'company' | 'space' | 'spaces-manage' | 'connection' | 'connections-manage' | 'network-manage' | 'profile' | 'settings' | 'notifications';
  company?: MergedCompany;
  contact?: DisplayContact | { id: string; name: string; email: string; title?: string; userName?: string };
  spaceId?: string;
  connectionId?: string;
  fromSpaceId?: string;
  fromProfile?: boolean;
  introSourceFilter?: string;
  introSpaceFilter?: string;
  introConnectionFilter?: string;
}

// =============================================================================
// Utility Functions
// =============================================================================

export function calculateStrength(lastSeenAt: string, meetingsCount: number): 'strong' | 'medium' | 'weak' {
  const daysSince = Math.floor((Date.now() - new Date(lastSeenAt).getTime()) / (1000 * 60 * 60 * 24));
  // Strong: frequent recent contact
  if (meetingsCount >= 5) return 'strong';
  if (daysSince <= 30 && meetingsCount >= 3) return 'strong';
  if (daysSince <= 14 && meetingsCount >= 2) return 'strong';
  // Medium: any meaningful contact
  if (meetingsCount >= 2) return 'medium';
  if (daysSince <= 90) return 'medium';
  // Weak: only 1 meeting and it was 90+ days ago
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

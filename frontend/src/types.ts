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
  sourceAccountEmail?: string;
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

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

export interface IntroOffer {
  id: string;
  requestId: string;
  introducerId: string;
  message: string;
  status: 'pending' | 'accepted' | 'rejected';
  createdAt: string;
}

export interface IntroOutcome {
  requestId: string;
  status: 'none' | 'intro_sent';
  updatedAt: string;
}

export interface MatchResult {
  userId: string;
  userName: string;
  companyId: string;
  companyDomain: string;
  companyName: string;
  finalScore: number;
  explanation: string;
}

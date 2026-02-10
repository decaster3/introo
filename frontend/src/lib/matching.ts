import type { NormalizedQuery, RelationshipEdge, MatchResult, Company, User } from '../types';

interface CalculateStrengthParams {
  meetingsCount: number;
  lastSeenAt: string;
}

export function calculateStrengthScore({ meetingsCount, lastSeenAt }: CalculateStrengthParams): number {
  const meetingsWeight = Math.log(1 + meetingsCount);
  const daysSinceLast = (Date.now() - new Date(lastSeenAt).getTime()) / (1000 * 60 * 60 * 24);
  const recencyWeight = Math.exp(-daysSinceLast / 30);
  return meetingsWeight * recencyWeight;
}

interface CalculateMatchMultiplierParams {
  query: NormalizedQuery;
  company: Company;
}

export function calculateMatchMultiplier({ query, company }: CalculateMatchMultiplierParams): number {
  // Exact domain match
  if (query.targetDomain && company.domain.toLowerCase() === query.targetDomain.toLowerCase()) {
    return 3.0;
  }

  const industryMatch = query.industry && company.industry?.toLowerCase() === query.industry.toLowerCase();
  const sizeBucketMatch = query.sizeBucket && company.sizeBucket === query.sizeBucket;

  // Industry + size bucket match
  if (industryMatch && sizeBucketMatch) {
    return 1.5;
  }

  // Industry match only
  if (industryMatch) {
    return 1.2;
  }

  return 1.0;
}

interface FindMatchesParams {
  query: NormalizedQuery;
  relationships: RelationshipEdge[];
  companies: Company[];
  users: User[];
  excludeUserId?: string; // Exclude requester from matches
}

export function findMatches({
  query,
  relationships,
  companies,
  users,
  excludeUserId,
}: FindMatchesParams): MatchResult[] {
  const results: MatchResult[] = [];

  for (const edge of relationships) {
    // Exclude the requester
    if (excludeUserId && edge.userId === excludeUserId) {
      continue;
    }

    const company = companies.find((c) => c.id === edge.companyId);
    const user = users.find((u) => u.id === edge.userId);

    if (!company || !user) {
      continue;
    }

    const strengthScore = calculateStrengthScore({
      meetingsCount: edge.meetingsCount,
      lastSeenAt: edge.lastSeenAt,
    });

    const matchMultiplier = calculateMatchMultiplier({ query, company });
    const finalScore = strengthScore * matchMultiplier;

    const daysSinceLast = Math.round(
      (Date.now() - new Date(edge.lastSeenAt).getTime()) / (1000 * 60 * 60 * 24)
    );

    const explanation = `Connected ${daysSinceLast} days ago at ${company.domain}`;

    results.push({
      userId: user.id,
      userName: user.name,
      companyId: company.id,
      companyDomain: company.domain,
      companyName: company.name,
      finalScore,
      explanation,
    });
  }

  // Sort by score descending and return top 5
  return results
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, 5);
}

export function formatScore(score: number): string {
  return score.toFixed(2);
}

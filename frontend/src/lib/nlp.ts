import type { NormalizedQuery } from '../types';

// Domain extraction regex
const domainRegex = /\b([a-z0-9-]+\.(com|io|co|org|net|so|ai|dev))\b/gi;

// Industry keywords mapping
const industryKeywords: Record<string, string[]> = {
  saas: ['saas', 'software', 'productivity', 'collaboration', 'crm', 'erp'],
  fintech: ['fintech', 'payments', 'banking', 'finance', 'financial', 'crypto'],
  healthcare: ['healthcare', 'health', 'medical', 'biotech', 'pharma'],
  security: ['security', 'cybersecurity', 'infosec', 'identity', 'authentication'],
};

// Size bucket keywords mapping
const sizeBucketKeywords: Record<string, string[]> = {
  '1-10': ['1-10', 'tiny', 'very small', 'micro', 'pre-seed', 'preseed'],
  '11-50': ['11-50', 'small', 'seed', 'early stage', 'early-stage'],
  '51-200': ['51-200', 'medium', 'mid-size', 'series a', 'series-a'],
  '200-1000': ['200-1000', 'large', 'growth', 'series b', 'series-b', 'series c', 'series-c'],
  '1000+': ['1000+', '1000 plus', 'enterprise', 'public', 'huge', 'unicorn'],
};

// Geo keywords
const geoKeywords: Record<string, string[]> = {
  US: ['us', 'usa', 'united states', 'america', 'american', 'sf', 'nyc', 'silicon valley'],
  EU: ['eu', 'europe', 'european', 'germany', 'france', 'berlin', 'paris', 'amsterdam'],
  UK: ['uk', 'united kingdom', 'britain', 'british', 'london', 'england'],
};

// Role keywords
const roleKeywords: Record<string, string[]> = {
  ceo: ['ceo', 'chief executive', 'founder', 'co-founder'],
  cto: ['cto', 'chief technology', 'tech lead', 'vp engineering'],
  cfo: ['cfo', 'chief financial', 'finance'],
  sales: ['sales', 'account executive', 'ae', 'sdr', 'bdr'],
  product: ['product', 'pm', 'product manager', 'head of product'],
  engineering: ['engineer', 'developer', 'swe', 'software engineer'],
};

function findMatch(text: string, keywordsMap: Record<string, string[]>): string | undefined {
  const lowerText = text.toLowerCase();
  for (const [key, keywords] of Object.entries(keywordsMap)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword)) {
        return key;
      }
    }
  }
  return undefined;
}

export function parseRequestText(rawText: string): NormalizedQuery {
  const query: NormalizedQuery = {};

  // Extract domain
  const domainMatch = rawText.match(domainRegex);
  if (domainMatch && domainMatch.length > 0) {
    query.targetDomain = domainMatch[0].toLowerCase();
  }

  // Extract industry
  query.industry = findMatch(rawText, industryKeywords);

  // Extract size bucket
  query.sizeBucket = findMatch(rawText, sizeBucketKeywords);

  // Extract geo
  query.geo = findMatch(rawText, geoKeywords);

  // Extract role
  query.role = findMatch(rawText, roleKeywords);

  return query;
}

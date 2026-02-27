import OpenAI from 'openai';
import prisma from '../lib/prisma.js';
import { embedCompany } from '../routes/embeddings.js';

const APIFY_BASE = 'https://api.apify.com/v2';
const ACTOR_ID = 'apify~website-content-crawler';
const MAX_CRAWL_PAGES = 1;
const MAX_CONTENT_CHARS = 12_000; // ~3k tokens — homepage is enough for a summary
const SCRAPE_TIMEOUT_MS = 60_000;
const IS_DEV = process.env.NODE_ENV !== 'production';
const DEV_LIMIT = 5;

const EMAIL_PROVIDER_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.de', 'hotmail.ca',
  'hotmail.co.uk', 'hotmail.fr', 'yahoo.com', 'yahoo.co.uk', 'yahoo.de',
  'ymail.com', 'outlook.com', 'outlook.de', 'outlook.co.uk', 'live.com',
  'live.de', 'msn.com', 'aol.com', 'icloud.com', 'me.com', 'mac.com',
  'mail.ru', 'inbox.ru', 'yandex.ru', 'yandex.com', 'protonmail.com',
  'proton.me', 'zoho.com', 'gmx.de', 'gmx.net', 'gmx.com', 'web.de',
  't-online.de', 'qq.com', '163.com', '126.com',
]);

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

function getApifyToken(): string {
  const token = process.env.APIFY_API_TOKEN;
  if (!token) throw new Error('APIFY_API_TOKEN is not configured');
  return token;
}

async function runApifyCrawl(url: string, crawlerType: string): Promise<string | null> {
  const token = getApifyToken();

  const response = await fetch(
    `${APIFY_BASE}/acts/${ACTOR_ID}/run-sync-get-dataset-items?token=${token}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        startUrls: [{ url }],
        maxCrawlPages: MAX_CRAWL_PAGES,
        crawlerType,
      }),
      signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (response.status === 402 || body.includes('memory-limit')) {
      const err = new Error(`Apify account limit reached (${response.status})`);
      (err as any).retryable = false;
      throw err;
    }
    throw new Error(`Apify returned ${response.status}: ${body.slice(0, 200)}`);
  }

  const items = (await response.json()) as { text?: string; markdown?: string }[];
  if (!items || items.length === 0) return null;

  const combined = items
    .map(item => item.markdown || item.text || '')
    .filter(Boolean)
    .join('\n\n---\n\n');

  if (!combined.trim()) return null;
  return combined.slice(0, MAX_CONTENT_CHARS);
}

export async function scrapeWebsite(url: string): Promise<string | null> {
  return runApifyCrawl(url, 'cheerio');
}

// Summarize scraped website content using GPT-4o-mini
export async function summarizeWebsite(
  content: string,
  companyName: string,
): Promise<string | null> {
  if (!process.env.OPENAI_API_KEY) return null;

  const response = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.3,
    max_tokens: 600,
    messages: [
      {
        role: 'system',
        content:
          'You are a concise business analyst. Summarize company websites into structured overviews. Write plain text only — no markdown, no bold, no headers, no bullet points. Separate paragraphs with a blank line.',
      },
      {
        role: 'user',
        content: `Summarize the following website content for "${companyName}". Cover: what the company does, their products/services, target market, and key differentiators. Write 2-3 concise paragraphs in plain text.\n\n${content}`,
      },
    ],
  });

  return response.choices[0]?.message?.content?.trim() || null;
}

// Full pipeline: scrape -> summarize -> save -> re-embed
export async function scrapeAndSummarizeCompany(company: {
  id: string;
  domain: string;
  name: string;
  websiteUrl?: string | null;
  description?: string | null;
  industry?: string | null;
  city?: string | null;
  country?: string | null;
}): Promise<boolean> {
  if (EMAIL_PROVIDER_DOMAINS.has(company.domain.toLowerCase())) {
    await prisma.company.update({
      where: { id: company.id },
      data: { scrapedAt: new Date() },
    });
    return false;
  }

  const url = company.websiteUrl || `https://${company.domain}`;

  try {
    console.log(`[scraper] Scraping ${url} for ${company.name}...`);
    const content = await scrapeWebsite(url);

    if (!content) {
      console.log(`[scraper] No content returned for ${company.domain}`);
      await prisma.company.update({
        where: { id: company.id },
        data: { scrapedAt: new Date() },
      });
      return false;
    }

    console.log(`[scraper] Got ${content.length} chars, summarizing...`);
    const summary = await summarizeWebsite(content, company.name);

    if (!summary) {
      console.log(`[scraper] Summary generation failed for ${company.domain}`);
      await prisma.company.update({
        where: { id: company.id },
        data: { scrapedAt: new Date() },
      });
      return false;
    }

    await prisma.company.update({
      where: { id: company.id },
      data: { websiteSummary: summary, scrapedAt: new Date() },
    });

    // Re-embed with the new summary data
    embedCompany(company.id, { ...company, websiteSummary: summary }).catch(err =>
      console.error(`[scraper] Re-embed failed for ${company.domain}:`, err.message),
    );

    console.log(`[scraper] Done: ${company.domain} (${summary.length} char summary)`);
    return true;
  } catch (err: any) {
    console.error(`[scraper] Failed for ${company.domain}:`, err.message);
    if (err.retryable === false) throw err;
    return false;
  }
}

// Batch-scrape all companies that haven't been scraped yet
export async function scrapeUnscrapedCompanies(
  onProgress?: (scraped: number, total: number) => void,
  signal?: { cancelled: boolean },
): Promise<{ scraped: number; skipped: number; errors: number; total: number }> {
  const companies = await prisma.company.findMany({
    where: { scrapedAt: null },
    select: {
      id: true,
      domain: true,
      name: true,
      websiteUrl: true,
      description: true,
      industry: true,
      city: true,
      country: true,
    },
    orderBy: { name: 'asc' },
  });

  const limit = IS_DEV ? Math.min(companies.length, DEV_LIMIT) : companies.length;
  const batch = companies.slice(0, limit);

  let scraped = 0;
  let skipped = 0;
  let errors = 0;

  for (const company of batch) {
    if (signal?.cancelled) break;

    try {
      const success = await scrapeAndSummarizeCompany(company);
      if (success) scraped++;
      else skipped++;
    } catch {
      errors++;
    }

    onProgress?.(scraped + skipped + errors, batch.length);
  }

  return { scraped, skipped, errors, total: batch.length };
}

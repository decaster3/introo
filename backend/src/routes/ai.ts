import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import OpenAI from 'openai';

const router = Router();
router.use(authMiddleware);

// Lazy-init OpenAI client so env var is read at request time
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const FILTER_SCHEMA = {
  type: 'object' as const,
  properties: {
    filters: {
      type: 'object' as const,
      properties: {
        description: {
          type: 'string' as const,
          description: 'Business type, industry, or description keyword to match (e.g. "fintech", "real estate", "SaaS")',
        },
        employeeRanges: {
          type: 'array' as const,
          items: {
            type: 'string' as const,
            enum: ['1-10', '11-50', '51-200', '201-1000', '1001-5000', '5000+'],
          },
          description: 'Employee count ranges to filter by',
        },
        country: {
          type: 'string' as const,
          description: 'Country name to filter by (e.g. "United States", "Germany")',
        },
        city: {
          type: 'string' as const,
          description: 'City name to filter by (e.g. "San Francisco", "London")',
        },
        fundingRounds: {
          type: 'array' as const,
          items: {
            type: 'string' as const,
            enum: ['no-funding', 'pre-seed', 'series-a', 'series-b'],
          },
          description: 'Funding rounds to filter by. "series-b" includes Series B, C, D, E and later.',
        },
        foundedFrom: {
          type: 'string' as const,
          description: 'Minimum founding year (e.g. "2020")',
        },
        foundedTo: {
          type: 'string' as const,
          description: 'Maximum founding year (e.g. "2024")',
        },
        revenueRanges: {
          type: 'array' as const,
          items: {
            type: 'string' as const,
            enum: ['0-1m', '1-10m', '10-50m', '50-100m', '100m+'],
          },
          description: 'Annual revenue ranges to filter by',
        },
        sourceFilter: {
          type: 'string' as const,
          enum: ['all', 'mine', 'spaces', 'both'],
          description: '"mine" = only my contacts, "spaces" = only from shared spaces, "both" = companies where I AND spaces have contacts, "all" = no filter',
        },
        strengthFilter: {
          type: 'string' as const,
          enum: ['all', 'strong', 'medium', 'weak'],
          description: 'Connection strength filter. "strong" = met recently/frequently, "weak" = old/infrequent contact',
        },
      },
      required: [] as string[],
      additionalProperties: false,
    },
    semanticKeywords: {
      type: 'array' as const,
      items: { type: 'string' as const },
      description: 'Expanded search keywords including synonyms, related terms, and job titles extracted from the query. These are used for fuzzy matching against company names, descriptions, contact names, and job titles.',
    },
    explanation: {
      type: 'string' as const,
      description: 'Short human-readable summary of what filters were applied, e.g. "Showing fintech companies in NYC with 10-50 employees"',
    },
  },
  required: ['filters', 'semanticKeywords', 'explanation'] as string[],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You are a search query parser for a professional networking app called Introo. Users search for companies and people in their network.

Your job is to convert natural language search queries into structured filters AND semantic keywords.

RULES:
1. Extract any structured filters that map to the available filter fields (location, employee count, funding, revenue, etc.)
2. For job titles, roles, company types, or other concepts that don't map to structured filters, put them in semanticKeywords as an expanded list including synonyms and related terms.
   - Example: "CTO" → ["cto", "chief technology officer", "vp engineering", "technical co-founder"]
   - Example: "fintech" → ["fintech", "financial technology", "payments", "banking tech"]
3. Only set filters you are confident about. Leave fields out if the query doesn't mention them.
4. For employee counts, map casual language: "startup" → "1-10" or "11-50", "enterprise" → "1001-5000" or "5000+", "small" → "1-10" or "11-50", "mid-size" → "51-200" or "201-1000"
5. For locations, use full country names (e.g. "United States" not "US") and common city names.
6. For "recent" or "new" companies, set foundedFrom to a reasonable recent year like "2020" or "2022".
7. The explanation should be concise (one sentence) and natural, summarizing what you understood.
8. If the query mentions "my network" or "my contacts", set sourceFilter to "mine". If it mentions "from spaces" or "shared", set to "spaces".`;

router.post('/parse-query', async (req, res) => {
  try {
    const { query, availableCountries, availableSpaces } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length < 3) {
      res.status(400).json({ error: 'Query must be at least 3 characters' });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error('OPENAI_API_KEY not set in environment');
      res.status(500).json({ error: 'OpenAI API key not configured' });
      return;
    }

    console.log(`[AI] Parsing query: "${query}"`);
    const startTime = Date.now();

    const contextHints = [];
    if (availableCountries?.length > 0) {
      contextHints.push(`Available countries in the data: ${availableCountries.slice(0, 30).join(', ')}`);
    }
    if (availableSpaces?.length > 0) {
      contextHints.push(`Available spaces (groups): ${availableSpaces.join(', ')}`);
    }

    const userMessage = contextHints.length > 0
      ? `Context:\n${contextHints.join('\n')}\n\nSearch query: "${query}"`
      : `Search query: "${query}"`;

    const completion = await getOpenAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'search_filters',
          strict: true,
          schema: FILTER_SCHEMA,
        },
      },
      temperature: 0.1,
      max_tokens: 500,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      res.status(500).json({ error: 'Empty response from AI' });
      return;
    }

    const parsed = JSON.parse(content);
    console.log(`[AI] Parsed in ${Date.now() - startTime}ms:`, JSON.stringify(parsed, null, 2));
    res.json(parsed);
  } catch (error: unknown) {
    console.error('AI parse-query error:', error);
    const message = error instanceof Error ? error.message : 'Failed to parse query';
    res.status(500).json({ error: message });
  }
});

export default router;

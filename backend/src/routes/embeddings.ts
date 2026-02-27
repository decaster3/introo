import { Router } from 'express';
import { authMiddleware, adminMiddleware, AuthenticatedRequest } from '../middleware/auth.js';
import OpenAI from 'openai';
import prisma from '../lib/prisma.js';

const router = Router();
router.use(authMiddleware);

let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

const EMBEDDING_MODEL = 'text-embedding-3-small';
const BATCH_SIZE = 100;

function buildEmbeddingText(company: {
  name: string;
  domain?: string | null;
  description?: string | null;
  industry?: string | null;
  city?: string | null;
  country?: string | null;
}): string {
  return [
    company.name,
    company.domain,
    company.industry,
    company.description,
    [company.city, company.country].filter(Boolean).join(', '),
  ].filter(Boolean).join(' | ');
}

// ─── Generate embeddings for companies (admin only) ──────────────────────────

router.post('/generate', adminMiddleware, async (req, res) => {
  try {
    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
      return;
    }

    const force = req.body.force === true;

    const whereClause = force
      ? `WHERE description IS NOT NULL AND description != ''`
      : `WHERE description IS NOT NULL AND description != '' AND "embeddedAt" IS NULL`;

    const toEmbed = await prisma.$queryRawUnsafe<
      { id: string; name: string; domain: string; description: string | null; industry: string | null; city: string | null; country: string | null }[]
    >(`SELECT id, name, domain, description, industry, city, country FROM companies ${whereClause} ORDER BY name`);

    console.log(`[embeddings] Found ${toEmbed.length} companies to embed (force=${force})`);

    if (toEmbed.length === 0) {
      res.json({ embedded: 0, total: 0, message: 'All companies already have embeddings' });
      return;
    }

    let embedded = 0;
    let errors = 0;

    for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
      const batch = toEmbed.slice(i, i + BATCH_SIZE);
      const texts = batch.map(c => buildEmbeddingText(c));

      try {
        const response = await getOpenAI().embeddings.create({
          model: EMBEDDING_MODEL,
          input: texts,
        });

        for (let j = 0; j < batch.length; j++) {
          const vector = response.data[j].embedding;
          const vectorStr = `[${vector.join(',')}]`;
          await prisma.$executeRawUnsafe(
            `UPDATE companies SET embedding = $1::vector, "embeddedAt" = NOW() WHERE id = $2`,
            vectorStr,
            batch[j].id,
          );
        }

        embedded += batch.length;
        console.log(`[embeddings] Progress: ${embedded}/${toEmbed.length}`);
      } catch (batchError) {
        errors += batch.length;
        console.error(`[embeddings] Batch error at offset ${i}:`, batchError);
      }
    }

    console.log(`[embeddings] Done: embedded=${embedded} errors=${errors}`);
    res.json({ embedded, errors, total: toEmbed.length });
  } catch (error: unknown) {
    console.error('Embedding generation error:', error);
    const message = error instanceof Error ? error.message : 'Failed to generate embeddings';
    res.status(500).json({ error: message });
  }
});

// ─── Semantic search ─────────────────────────────────────────────────────────

const THRESHOLD_PRESETS: Record<number, number> = {
  1: 0.20,
  2: 0.30,
  3: 0.42,
};

router.post('/search', async (req, res) => {
  try {
    const { query, limit = 100, precision = 2 } = req.body;

    if (!query || typeof query !== 'string' || query.trim().length < 3) {
      res.status(400).json({ error: 'Query must be at least 3 characters' });
      return;
    }

    if (!process.env.OPENAI_API_KEY) {
      res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
      return;
    }

    const safeLimit = Math.min(Math.max(1, Number(limit) || 100), 500);
    const level = Math.min(3, Math.max(1, Math.round(Number(precision) || 2)));
    const threshold = THRESHOLD_PRESETS[level] ?? 0.35;

    console.log(`[embeddings] Semantic search: "${query.trim()}" precision=${level} threshold=${threshold}`);
    const startTime = Date.now();

    const embResponse = await getOpenAI().embeddings.create({
      model: EMBEDDING_MODEL,
      input: query.trim(),
    });
    const queryVector = embResponse.data[0].embedding;
    const vectorStr = `[${queryVector.join(',')}]`;

    const results = await prisma.$queryRawUnsafe<
      { domain: string; name: string; similarity: number }[]
    >(
      `SELECT domain, name, 1 - (embedding <=> $1::vector) AS similarity
       FROM companies
       WHERE embedding IS NOT NULL AND 1 - (embedding <=> $1::vector) >= $2
       ORDER BY embedding <=> $1::vector
       LIMIT $3`,
      vectorStr,
      threshold,
      safeLimit,
    );

    const ms = Date.now() - startTime;
    console.log(`[embeddings] Found ${results.length} results in ${ms}ms`);

    res.json({
      results: results.map(r => ({
        domain: r.domain,
        name: r.name,
        similarity: Math.round(Number(r.similarity) * 1000) / 1000,
      })),
      query: query.trim(),
      precision: level,
      threshold,
      ms,
    });
  } catch (error: unknown) {
    console.error('Semantic search error:', error);
    const message = error instanceof Error ? error.message : 'Semantic search failed';
    res.status(500).json({ error: message });
  }
});

// ─── Stats ───────────────────────────────────────────────────────────────────

router.get('/stats', async (_req, res) => {
  try {
    const [total, withDescription, embedded] = await Promise.all([
      prisma.company.count(),
      prisma.company.count({ where: { description: { not: null } } }),
      prisma.company.count({ where: { embeddedAt: { not: null } } }),
    ]);
    res.json({ total, withDescription, embedded, pending: withDescription - embedded });
  } catch (error) {
    console.error('Embedding stats error:', error);
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ─── Debug: inspect what text was embedded for a company (dev only) ───────────

router.get('/debug/:domain', adminMiddleware, async (req, res) => {
  try {
    const company = await prisma.company.findUnique({
      where: { domain: req.params.domain },
      select: {
        id: true, domain: true, name: true, description: true,
        industry: true, city: true, country: true, embeddedAt: true,
      },
    });
    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    const embeddingText = buildEmbeddingText(company);

    const hasEmbedding = await prisma.$queryRawUnsafe<{ has: boolean }[]>(
      `SELECT embedding IS NOT NULL AS has FROM companies WHERE id = $1`,
      company.id,
    );

    res.json({
      domain: company.domain,
      name: company.name,
      embeddingText,
      textLength: embeddingText.length,
      hasEmbedding: hasEmbedding[0]?.has ?? false,
      embeddedAt: company.embeddedAt,
      fields: {
        description: !!company.description,
        industry: !!company.industry,
        city: !!company.city,
        country: !!company.country,
      },
    });
  } catch (error) {
    console.error('Debug endpoint error:', error);
    res.status(500).json({ error: 'Debug lookup failed' });
  }
});

// ─── Embed a single company (used internally after enrichment) ───────────────

export async function embedCompany(companyId: string, company: {
  name: string;
  domain?: string | null;
  description?: string | null;
  industry?: string | null;
  city?: string | null;
  country?: string | null;
}): Promise<void> {
  if (!company.description || !process.env.OPENAI_API_KEY) return;

  const text = buildEmbeddingText(company);
  const response = await getOpenAI().embeddings.create({
    model: EMBEDDING_MODEL,
    input: text,
  });

  const vector = response.data[0].embedding;
  const vectorStr = `[${vector.join(',')}]`;
  await prisma.$executeRawUnsafe(
    `UPDATE companies SET embedding = $1::vector, "embeddedAt" = NOW() WHERE id = $2`,
    vectorStr,
    companyId,
  );
}

export default router;

-- Enable pgvector extension for semantic search
CREATE EXTENSION IF NOT EXISTS vector;

-- Add embedding column (1536 dimensions = OpenAI text-embedding-3-small)
ALTER TABLE "companies" ADD COLUMN "embedding" vector(1536);

-- Track when embedding was last generated
ALTER TABLE "companies" ADD COLUMN "embeddedAt" TIMESTAMP(3);

-- Index for fast cosine similarity search (ivfflat with 50 lists, good for up to ~50k rows)
-- Note: ivfflat requires at least some rows to exist; the index is created now but
-- will only be useful after embeddings are populated.
CREATE INDEX "companies_embedding_idx" ON "companies"
  USING ivfflat ("embedding" vector_cosine_ops)
  WITH (lists = 50);

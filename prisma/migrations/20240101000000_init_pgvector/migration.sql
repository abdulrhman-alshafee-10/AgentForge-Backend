-- ─── Phase 06: pgvector setup ────────────────────────────────────────────────
-- Enables the pgvector extension and creates an HNSW index on the Embedding
-- table for efficient approximate nearest-neighbour search.
--
-- Run this migration manually if your DB was set up before Phase 06:
--   psql $DATABASE_URL -f prisma/migrations/20240101000000_init_pgvector/migration.sql
--
-- Or include it in your Prisma migration history by placing it before the
-- baseline migration and running: prisma migrate resolve --applied <name>

-- 1. Enable pgvector extension (idempotent)
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. Add the vector column to Embedding if it does not exist yet.
--    Prisma marks this as Unsupported("vector(768)") so it skips it in
--    auto-generated migrations — we manage it here.
ALTER TABLE "Embedding"
  ADD COLUMN IF NOT EXISTS "embedding" vector(768);

-- 3. HNSW index for cosine distance (<=>).
--    HNSW is preferred over IVFFlat for most workloads because it does not
--    require a training phase and degrades gracefully as the dataset grows.
--    m=16 / ef_construction=64 are sensible defaults for a 768-dim model.
CREATE INDEX IF NOT EXISTS "Embedding_embedding_hnsw_idx"
  ON "Embedding"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

-- 4. Composite index to allow fast tenant-scoped vector searches.
CREATE INDEX IF NOT EXISTS "Embedding_tenantId_idx"
  ON "Embedding" ("tenantId");

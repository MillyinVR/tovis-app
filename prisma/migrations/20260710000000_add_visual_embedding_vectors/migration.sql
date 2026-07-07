-- Personalization spec §6.0: visual-embedding pipeline foundation.
--
-- pgvector-backed storage for (a) one CLIP-style embedding per look's primary
-- image, written by the new EMBED_LOOK_POST_IMAGE LooksSocialJob at publish
-- time, and (b) global-per-client + local-per-board taste vectors (decayed,
-- signal-weighted averages of the embeddings of liked/saved looks).
--
-- All vector columns are declared Unsupported("vector(1024)") in
-- schema.prisma; reads/writes go through raw SQL only (same pattern as the
-- PostGIS ProfessionalSearchIndex migration, 20260509000000). These tables are
-- dark-loaded until the ranking pass consumes them — a missing row simply
-- means "no visual signal yet".

-- 1. pgvector extension. Idempotent. Supabase has the extension pre-bundled
--    (`vector` 0.8.0 on the prod project); this enables it for our database,
--    matching how 20260509000000 enabled postgis. Local/CI containers use the
--    imresamu/postgis bundle image, which ships vector.control.
CREATE EXTENSION IF NOT EXISTS vector;

-- 2. New LooksSocialJob type for embed-at-upload. Safe inside the migration
--    transaction because nothing in this migration uses the new value.
ALTER TYPE "LooksSocialJobType" ADD VALUE 'EMBED_LOOK_POST_IMAGE';

-- 3. Per-look embedding of the primary image.
CREATE TABLE "LookPostEmbedding" (
    "lookPostId" TEXT NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "model" TEXT NOT NULL,
    "mediaAssetId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LookPostEmbedding_pkey" PRIMARY KEY ("lookPostId")
);

CREATE INDEX "LookPostEmbedding_model_idx" ON "LookPostEmbedding"("model");

-- Deliberately NO ANN (hnsw) index yet: ranking consumption reads candidate
-- embeddings by primary key, so nothing runs a corpus-wide similarity scan.
-- Unlike the PostGIS GIST precedent, `prisma migrate diff` flags an hnsw index
-- it can't see in schema.prisma as drift, so the index ships WITH its first
-- corpus-wide-similarity consumer (as CREATE INDEX CONCURRENTLY over the
-- then-populated corpus — also the faster way to build hnsw).

ALTER TABLE "LookPostEmbedding"
  ADD CONSTRAINT "LookPostEmbedding_lookPostId_fkey"
  FOREIGN KEY ("lookPostId") REFERENCES "LookPost"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. Global taste vector per client (§6.1 global_taste_embedding).
CREATE TABLE "ClientTasteVector" (
    "clientProfileId" TEXT NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "model" TEXT NOT NULL,
    "signalCount" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientTasteVector_pkey" PRIMARY KEY ("clientProfileId")
);

ALTER TABLE "ClientTasteVector"
  ADD CONSTRAINT "ClientTasteVector_clientProfileId_fkey"
  FOREIGN KEY ("clientProfileId") REFERENCES "ClientProfile"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- 5. Per-board local taste vector (§6.1 board_contexts.local_taste_embedding).
CREATE TABLE "BoardTasteVector" (
    "boardId" TEXT NOT NULL,
    "embedding" vector(1024) NOT NULL,
    "model" TEXT NOT NULL,
    "signalCount" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardTasteVector_pkey" PRIMARY KEY ("boardId")
);

ALTER TABLE "BoardTasteVector"
  ADD CONSTRAINT "BoardTasteVector_boardId_fkey"
  FOREIGN KEY ("boardId") REFERENCES "Board"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

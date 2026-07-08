// lib/personalization/lookEmbeddingStore.ts
//
// Raw-SQL persistence for LookPostEmbedding. The `embedding` column is
// pgvector's vector(1024) — declared Unsupported(...) in schema.prisma, so the
// typed Prisma client can neither read nor write it (same constraint as
// ProfessionalSearchIndex.geom). Every vector crosses the wire as its text
// literal ('[0.1,0.2,...]') cast with ::vector; the serialize/parse helpers
// here are the single source of truth for that encoding and are reused by the
// taste-vector writer.

import { Prisma } from '@prisma/client'

import { LOOK_EMBEDDING_DIMENSIONS } from '@/lib/personalization/lookEmbedding'

/**
 * The raw-SQL capabilities the store needs, expressed structurally so both
 * PrismaClient and Prisma.TransactionClient satisfy it — and so tests can pass
 * a plain mock without type escapes (same pattern as
 * lib/looks/categoryRankStats.ts).
 */
export type EmbeddingSqlDb = {
  $executeRaw(
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ): PromiseLike<number>
  $queryRaw<T = unknown>(
    query: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ): PromiseLike<T>
}

/**
 * Encode a vector as pgvector's text literal, validating dimension and
 * finiteness so a malformed provider response can never reach the database.
 */
export function serializeEmbeddingVector(vector: readonly number[]): string {
  if (vector.length !== LOOK_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding has ${vector.length} dimensions; expected ${LOOK_EMBEDDING_DIMENSIONS}.`,
    )
  }
  for (const component of vector) {
    if (typeof component !== 'number' || !Number.isFinite(component)) {
      throw new Error('Embedding contained a non-finite component.')
    }
  }
  return `[${vector.join(',')}]`
}

/** Decode pgvector's text literal back into a number array. */
export function parseEmbeddingVectorText(text: string): number[] {
  const trimmed = text.trim()
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    throw new Error('Embedding text is not a pgvector literal.')
  }

  const vector = trimmed
    .slice(1, -1)
    .split(',')
    .map((part) => Number.parseFloat(part))

  if (vector.length !== LOOK_EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Embedding text has ${vector.length} dimensions; expected ${LOOK_EMBEDDING_DIMENSIONS}.`,
    )
  }
  if (vector.some((component) => !Number.isFinite(component))) {
    throw new Error('Embedding text contained a non-finite component.')
  }

  return vector
}

export async function upsertLookPostEmbedding(
  db: EmbeddingSqlDb,
  args: {
    lookPostId: string
    mediaAssetId: string
    model: string
    embedding: readonly number[]
    now: Date
  },
): Promise<void> {
  const vectorText = serializeEmbeddingVector(args.embedding)

  await db.$executeRaw`
    INSERT INTO "LookPostEmbedding"
      ("lookPostId", "embedding", "model", "mediaAssetId", "createdAt", "updatedAt")
    VALUES
      (${args.lookPostId}, ${vectorText}::vector, ${args.model}, ${args.mediaAssetId}, ${args.now}, ${args.now})
    ON CONFLICT ("lookPostId") DO UPDATE SET
      "embedding" = EXCLUDED."embedding",
      "model" = EXCLUDED."model",
      "mediaAssetId" = EXCLUDED."mediaAssetId",
      "updatedAt" = EXCLUDED."updatedAt"
  `
}

export type LookPostEmbeddingVector = {
  lookPostId: string
  embedding: number[]
}

/**
 * Fetch embeddings for a set of looks. Missing looks (not yet embedded) are
 * simply absent from the result — callers treat absence as "no visual signal".
 */
export async function fetchLookPostEmbeddings(
  db: EmbeddingSqlDb,
  lookPostIds: readonly string[],
): Promise<Map<string, number[]>> {
  const ids = [...new Set(lookPostIds)].filter((id) => id.length > 0)
  if (ids.length === 0) return new Map()

  const rows = await db.$queryRaw<
    Array<{ lookPostId: string; embeddingText: string }>
  >`
    SELECT "lookPostId", "embedding"::text AS "embeddingText"
    FROM "LookPostEmbedding"
    WHERE "lookPostId" IN (${Prisma.join(ids)})
  `

  const result = new Map<string, number[]>()
  for (const row of rows) {
    result.set(row.lookPostId, parseEmbeddingVectorText(row.embeddingText))
  }
  return result
}

export type ClientTasteVectorRow = {
  embedding: number[]
  // How many embedded signals built the vector — the ranking layer's confidence
  // knob (a 2-signal vector should steer far less than a 50-signal one).
  signalCount: number
}

/**
 * Fetch a client's global taste vector (§6.1 global_taste_embedding). Returns
 * null when the client has no stored vector yet — pre-backfill, no like/save
 * history, or all their signals sit on looks that aren't embedded — which the
 * ranking layer reads as "no visual signal, no boost".
 */
export async function fetchClientTasteVector(
  db: EmbeddingSqlDb,
  clientProfileId: string,
): Promise<ClientTasteVectorRow | null> {
  if (clientProfileId.length === 0) return null

  const rows = await db.$queryRaw<
    Array<{ embeddingText: string; signalCount: number }>
  >`
    SELECT "embedding"::text AS "embeddingText", "signalCount"
    FROM "ClientTasteVector"
    WHERE "clientProfileId" = ${clientProfileId}
    LIMIT 1
  `

  const row = rows[0]
  if (!row) return null

  return {
    embedding: parseEmbeddingVectorText(row.embeddingText),
    // Raw-SQL int columns can surface as bigint; normalize to a JS number.
    signalCount: Number(row.signalCount),
  }
}

// lib/personalization/lookEmbedding.ts
//
// Visual-embedding client for the §6.0 pipeline: one CLIP-style vector per
// look image, produced by Voyage AI's multimodal embedding API (Anthropic has
// no embeddings endpoint, so this is a separate provider + key). The key lives
// server-side only; image bytes are sent in-flight for vectorization and never
// logged or persisted beyond the resulting vector.
//
// The provider is deliberately optional: when VOYAGE_API_KEY is unset the
// pipeline degrades to a no-op (the embed job completes as SKIPPED and the
// backfill script catches the corpus up once the key exists), so shipping this
// code does not block deploys on provisioning the key.

import { readOptionalEnv } from '@/lib/env'

// Dimension of every stored vector. Must match the vector(1024) columns in
// prisma/schema.prisma (LookPostEmbedding / ClientTasteVector /
// BoardTasteVector) — changing either side alone corrupts nothing but rejects
// every write, so they must move together (with a re-embed backfill).
export const LOOK_EMBEDDING_DIMENSIONS = 1024

// voyage-multimodal-3.5 outputs 1024-dim vectors by default — exactly the
// column dimension above. Overridable per environment, but any override must
// keep the output dimension at 1024.
const DEFAULT_LOOK_EMBEDDING_MODEL = 'voyage-multimodal-3.5'

const VOYAGE_MULTIMODAL_EMBEDDINGS_URL =
  'https://api.voyageai.com/v1/multimodalembeddings'

// Keep well under the looks-social cron route's maxDuration (60 s) so one slow
// provider call can't eat the whole batch window.
const REQUEST_TIMEOUT_MS = 45_000

// Voyage rejects images over 20 MB; refuse before uploading.
export const LOOK_EMBEDDING_MAX_IMAGE_BYTES = 19_000_000

/** Image content types the provider accepts as base64 data URLs. */
export const LOOK_EMBEDDING_IMAGE_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const

export type LookEmbeddingImageContentType =
  (typeof LOOK_EMBEDDING_IMAGE_CONTENT_TYPES)[number]

export function pickLookEmbeddingImageContentType(
  value: string | null | undefined,
): LookEmbeddingImageContentType | null {
  const normalized = value?.trim().toLowerCase() ?? ''
  return (
    LOOK_EMBEDDING_IMAGE_CONTENT_TYPES.find((type) => type === normalized) ??
    null
  )
}

export type LookEmbeddingConfig = {
  apiKey: string
  model: string
}

/**
 * Provider configuration, or null when the pipeline is unconfigured (no
 * VOYAGE_API_KEY). Callers treat null as "skip quietly", never as an error.
 */
export function readLookEmbeddingConfig(): LookEmbeddingConfig | null {
  const apiKey = readOptionalEnv('VOYAGE_API_KEY')
  if (!apiKey) return null

  return {
    apiKey,
    model: readOptionalEnv('LOOK_EMBEDDING_MODEL') ?? DEFAULT_LOOK_EMBEDDING_MODEL,
  }
}

export type LookEmbeddingErrorKind = 'unavailable' | 'bad_input' | 'bad_output'

export class LookEmbeddingError extends Error {
  readonly kind: LookEmbeddingErrorKind

  constructor(kind: LookEmbeddingErrorKind, message: string) {
    super(message)
    this.name = 'LookEmbeddingError'
    this.kind = kind
  }
}

function assertEmbeddingVector(value: unknown): number[] {
  if (!Array.isArray(value)) {
    throw new LookEmbeddingError(
      'bad_output',
      'Embedding response did not contain a vector.',
    )
  }
  if (value.length !== LOOK_EMBEDDING_DIMENSIONS) {
    throw new LookEmbeddingError(
      'bad_output',
      `Embedding has ${value.length} dimensions; expected ${LOOK_EMBEDDING_DIMENSIONS}.`,
    )
  }
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) {
      throw new LookEmbeddingError(
        'bad_output',
        'Embedding contained a non-finite component.',
      )
    }
  }
  return value as number[]
}

type MultimodalEmbeddingsResponse = {
  data?: Array<{ embedding?: unknown }>
}

/**
 * The slice of fetch this client uses, expressed structurally so the global
 * fetch satisfies it and tests can inject a plain typed mock (no type
 * escapes). Kept deliberately minimal — headers as a plain record, body as a
 * string — because that is all the Voyage call needs.
 */
export type EmbeddingFetchInit = {
  method: string
  headers: Record<string, string>
  body: string
  signal: AbortSignal
}

export type EmbeddingFetchResponse = {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type EmbeddingFetch = (
  url: string,
  init: EmbeddingFetchInit,
) => Promise<EmbeddingFetchResponse>

/**
 * Embed one look image. `bytes` are the raw image bytes (already downloaded
 * from storage by the caller); `contentType` must be one of the accepted image
 * types. Throws LookEmbeddingError — callers in the job queue let it propagate
 * so the queue's retry/backoff applies.
 */
export async function embedLookImage(args: {
  config: LookEmbeddingConfig
  bytes: Uint8Array
  contentType: LookEmbeddingImageContentType
  fetchImpl?: EmbeddingFetch
}): Promise<number[]> {
  if (args.bytes.byteLength === 0) {
    throw new LookEmbeddingError('bad_input', 'Image is empty.')
  }
  if (args.bytes.byteLength > LOOK_EMBEDDING_MAX_IMAGE_BYTES) {
    throw new LookEmbeddingError(
      'bad_input',
      `Image is ${args.bytes.byteLength} bytes; provider limit is ${LOOK_EMBEDDING_MAX_IMAGE_BYTES}.`,
    )
  }

  const doFetch: EmbeddingFetch = args.fetchImpl ?? fetch
  const base64 = Buffer.from(args.bytes).toString('base64')

  let response: EmbeddingFetchResponse
  try {
    response = await doFetch(VOYAGE_MULTIMODAL_EMBEDDINGS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${args.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: args.config.model,
        // Look images are corpus documents; taste vectors are averaged from
        // these same document vectors, so everything stays in one space.
        input_type: 'document',
        inputs: [
          {
            content: [
              {
                type: 'image_base64',
                image_base64: `data:${args.contentType};base64,${base64}`,
              },
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw new LookEmbeddingError(
      'unavailable',
      error instanceof Error ? error.message : 'Embedding request failed.',
    )
  }

  if (!response.ok) {
    // Body may carry provider detail but can also echo input — keep the error
    // to status only so image bytes can never leak into logs.
    throw new LookEmbeddingError(
      'unavailable',
      `Embedding request failed with status ${response.status}.`,
    )
  }

  let parsed: MultimodalEmbeddingsResponse
  try {
    parsed = (await response.json()) as MultimodalEmbeddingsResponse
  } catch {
    throw new LookEmbeddingError(
      'bad_output',
      'Embedding response was not JSON.',
    )
  }

  return assertEmbeddingVector(parsed.data?.[0]?.embedding)
}

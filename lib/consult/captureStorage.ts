import 'server-only'

import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

import { BUCKETS } from '@/lib/storageBuckets'

import type { ConsultCaptureMediaType } from './captureVision'

export const CONSULT_CAPTURE_BUCKET = BUCKETS.mediaPrivate
// Definition moved to capturePack (client-safe) so the browser wizard can
// downscale against the same cap; re-exported to keep server call sites.
export { CONSULT_CAPTURE_MAX_BYTES } from './capturePack'

const LOCAL_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'host.docker.internal',
])

export class ConsultCaptureStorageError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'missing' | 'invalid',
  ) {
    super('Private capture storage is unavailable.')
    this.name = 'ConsultCaptureStorageError'
  }
}

export type ConsultStoredObject = {
  contentType: ConsultCaptureMediaType
  sizeBytes: number
  checksumSha256: string | null
}

export type ConsultCaptureImage = {
  base64: string
  mediaType: ConsultCaptureMediaType
}

export type ConsultSignedUpload = {
  token: string
  signedUrl: string | null
}

export interface ConsultCaptureStorage {
  assertReady(): Promise<void>
  createSignedUpload(path: string): Promise<ConsultSignedUpload>
  inspectObject(args: {
    path: string
    expectedContentType: ConsultCaptureMediaType
    maxBytes: number
    expectedChecksumSha256: string | null
  }): Promise<ConsultStoredObject>
  readObject(args: {
    path: string
    expectedContentType: ConsultCaptureMediaType
    maxBytes: number
  }): Promise<ConsultCaptureImage>
  createSignedRead(path: string, expiresInSeconds: number): Promise<string>
  purgeObject(path: string): Promise<void>
  /** In-bucket copy to a durable path (chart copy). Fails closed. */
  copyObject(args: { fromPath: string; toPath: string }): Promise<void>
}

function parseUrl(raw: string | undefined): URL {
  const value = raw?.trim()
  if (!value) throw new ConsultCaptureStorageError('unavailable')
  try {
    return new URL(value)
  } catch {
    throw new ConsultCaptureStorageError('unavailable')
  }
}

function projectIdentity(url: URL, kind: 'database' | 'storage'): string | null {
  const host = url.hostname.toLowerCase()
  if (LOCAL_HOSTS.has(host)) return 'local'
  if (kind === 'storage') {
    const match = host.match(/^([a-z0-9-]+)\.supabase\.co$/)
    return match?.[1] ?? null
  }

  const direct = host.match(/^db\.([a-z0-9-]+)\.supabase\.co$/)
  if (direct?.[1]) return direct[1]
  const username = decodeURIComponent(url.username)
  const pooled = username.match(/^postgres\.([a-z0-9-]+)$/)
  return pooled?.[1] ?? null
}

/** Consult capture is fail-closed: both endpoints must be recognizable and
 * identify the same local or remote Supabase environment. */
export function assertConsultStorageEnvironment(): void {
  const database = parseUrl(process.env.DATABASE_URL)
  const storage = parseUrl(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
  )
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new ConsultCaptureStorageError('unavailable')
  }

  const databaseIdentity = projectIdentity(database, 'database')
  const storageIdentity = projectIdentity(storage, 'storage')
  if (
    !databaseIdentity ||
    !storageIdentity ||
    databaseIdentity !== storageIdentity
  ) {
    throw new ConsultCaptureStorageError('unavailable')
  }
}

async function admin(): Promise<SupabaseClient> {
  try {
    // Lazy import is deliberate: a missing storage env must become the stable
    // fail-closed API error, not crash route-module evaluation.
    const supabaseAdminModule = await import('@/lib/supabaseAdmin')
    return supabaseAdminModule.getSupabaseAdmin()
  } catch {
    throw new ConsultCaptureStorageError('unavailable')
  }
}

function signedUrl(value: unknown): string | null {
  if (!value || typeof value !== 'object' || !('signedUrl' in value)) return null
  const candidate = value.signedUrl
  return typeof candidate === 'string' && candidate.trim() ? candidate : null
}

function isMediaType(value: string | undefined): value is ConsultCaptureMediaType {
  return value === 'image/jpeg' || value === 'image/png' || value === 'image/webp'
}

async function downloadVerified(args: {
  path: string
  expectedContentType: ConsultCaptureMediaType
  maxBytes: number
}): Promise<{ bytes: Uint8Array; contentType: ConsultCaptureMediaType }> {
  const { data, error } = await (await admin())
    .storage.from(CONSULT_CAPTURE_BUCKET)
    .download(args.path, {}, { cache: 'no-store' })
  if (error || !data) throw new ConsultCaptureStorageError('missing')

  const contentType = data.type.toLowerCase()
  if (
    !isMediaType(contentType) ||
    contentType !== args.expectedContentType ||
    data.size < 1 ||
    data.size > args.maxBytes
  ) {
    throw new ConsultCaptureStorageError('invalid')
  }

  return {
    bytes: new Uint8Array(await data.arrayBuffer()),
    contentType,
  }
}

export const consultCaptureStorage: ConsultCaptureStorage = {
  async assertReady() {
    assertConsultStorageEnvironment()
    const { data, error } = await (await admin()).storage.getBucket(
      CONSULT_CAPTURE_BUCKET,
    )
    if (error || !data || data.public) {
      throw new ConsultCaptureStorageError('unavailable')
    }
  },

  async createSignedUpload(path) {
    const { data, error } = await (await admin())
      .storage.from(CONSULT_CAPTURE_BUCKET)
      .createSignedUploadUrl(path, { upsert: false })
    if (
      error ||
      !data ||
      typeof data.token !== 'string' ||
      !data.token.trim()
    ) {
      throw new ConsultCaptureStorageError('unavailable')
    }
    return { token: data.token, signedUrl: signedUrl(data) }
  },

  async inspectObject(args) {
    const { data, error } = await (await admin())
      .storage.from(CONSULT_CAPTURE_BUCKET)
      .info(args.path)
    if (error || !data) throw new ConsultCaptureStorageError('missing')

    const contentType = data.contentType?.toLowerCase()
    const sizeBytes = data.size
    if (
      !isMediaType(contentType) ||
      contentType !== args.expectedContentType ||
      typeof sizeBytes !== 'number' ||
      !Number.isInteger(sizeBytes) ||
      sizeBytes < 1 ||
      sizeBytes > args.maxBytes
    ) {
      throw new ConsultCaptureStorageError('invalid')
    }

    let checksumSha256: string | null = null
    if (args.expectedChecksumSha256) {
      const downloaded = await downloadVerified({
        path: args.path,
        expectedContentType: args.expectedContentType,
        maxBytes: args.maxBytes,
      })
      checksumSha256 = createHash('sha256').update(downloaded.bytes).digest('hex')
      if (checksumSha256 !== args.expectedChecksumSha256) {
        throw new ConsultCaptureStorageError('invalid')
      }
    }

    return { contentType, sizeBytes, checksumSha256 }
  },

  async readObject(args) {
    const downloaded = await downloadVerified(args)
    return {
      base64: Buffer.from(downloaded.bytes).toString('base64'),
      mediaType: downloaded.contentType,
    }
  },

  async createSignedRead(path, expiresInSeconds) {
    const { data, error } = await (await admin())
      .storage.from(CONSULT_CAPTURE_BUCKET)
      .createSignedUrl(path, expiresInSeconds)
    const url = signedUrl(data)
    if (error || !url) throw new ConsultCaptureStorageError('unavailable')
    return url
  },

  async purgeObject(path) {
    const bucket = (await admin()).storage.from(CONSULT_CAPTURE_BUCKET)
    const removed = await bucket.remove([path])
    if (removed.error) throw new ConsultCaptureStorageError('unavailable')

    const absent = await bucket.exists(path)
    if (absent.data !== false) {
      throw new ConsultCaptureStorageError('unavailable')
    }
  },

  async copyObject(args) {
    const bucket = (await admin()).storage.from(CONSULT_CAPTURE_BUCKET)
    const copied = await bucket.copy(args.fromPath, args.toPath)
    if (copied.error) {
      // An existing destination means an earlier attempt already copied this
      // object; the destination paths are deterministic per capture, so treat
      // "already exists" as success rather than failing the chart copy.
      const exists = await bucket.exists(args.toPath)
      if (exists.data === true) return
      throw new ConsultCaptureStorageError('unavailable')
    }
  },
}

export function consultCaptureObjectPath(
  contentType: ConsultCaptureMediaType,
): string {
  const extension =
    contentType === 'image/jpeg'
      ? 'jpg'
      : contentType === 'image/png'
        ? 'png'
        : 'webp'
  return `consult-raw/v1/${randomUUID()}.${extension}`
}

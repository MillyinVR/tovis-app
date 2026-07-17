// lib/media/storageEnvironment.ts
//
// Refuses to mint a signed upload when the server is running against a LOCAL
// database but a REMOTE Supabase project.
//
// ## Why this exists
// `.env.development.local` overrides `DATABASE_URL` (→ localhost:5434) but does
// NOT set `NEXT_PUBLIC_SUPABASE_URL`, so storage falls through to `.env.local` —
// which holds the production project. Local dev therefore runs with its database
// and its object storage in DIFFERENT environments, and nothing says so: the
// MediaAsset row lands in the local DB while the actual bytes are PUT into the
// production bucket. The result is an orphan object in prod (no prod row
// references it) plus whatever the developer just uploaded, which may be a real
// client photo. It is silent, and every media flow driven locally does it.
//
// Reads are deliberately NOT guarded — rendering prod media locally is harmless
// and is what makes the seeded data look right. Only the WRITE is refused, at the
// one moment authorization to write is minted.
//
// ## Fail OPEN, always
// This must never block a real deploy, so it only fires when it is CERTAIN of
// both halves: the database is definitively local AND storage is definitively
// remote. Anything unrecognized → no mismatch → sign as normal. In production the
// database is remote, so the first check exits immediately; in CI both point at
// 127.0.0.1 (`NEXT_PUBLIC_SUPABASE_URL: http://127.0.0.1:54321`), so they agree.

const LOCAL_HOSTNAMES = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  'host.docker.internal',
])

function hostnameOf(rawUrl: string | undefined): string | null {
  const value = rawUrl?.trim()
  if (!value) return null

  try {
    // Handles postgresql://user:pass@host:port/db as well as https://x.supabase.co
    return new URL(value).hostname.toLowerCase()
  } catch {
    return null
  }
}

function isLocalHostname(hostname: string | null): boolean {
  return hostname != null && LOCAL_HOSTNAMES.has(hostname)
}

/** The storage project this server writes to (same precedence as getSupabaseAdmin). */
function storageUrl(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    process.env.SUPABASE_URL?.trim()
  )
}

/**
 * Returns an explanatory message when signing an upload right now would write
 * bytes into a remote bucket from a local database — or `null` when the
 * environments agree (or when we can't tell, which is treated as agreeing).
 *
 * Callers should refuse the request with the returned message. It's phrased for a
 * developer because it is the only audience that can ever see it: production has
 * a remote database and can't reach this branch.
 */
export function getStorageEnvironmentMismatch(): string | null {
  // Unit tests mock the storage client entirely — they never write real bytes,
  // and .env.test.local carries the remote URL, so this would fire on every
  // signing-route test for no benefit.
  if (process.env.NODE_ENV === 'test') return null

  // Deliberate escape hatch for anyone who genuinely means it.
  if (process.env.TOVIS_ALLOW_REMOTE_STORAGE_FROM_LOCAL === '1') return null

  const databaseHost = hostnameOf(process.env.DATABASE_URL)
  if (!isLocalHostname(databaseHost)) return null

  const storage = storageUrl()
  const storageHost = hostnameOf(storage)
  if (!storageHost || isLocalHostname(storageHost)) return null

  return (
    `Refusing to sign an upload: this server's database is local (${databaseHost}) ` +
    `but its storage is remote (${storageHost}). The bytes would be written to that ` +
    `remote project while the row stays in your local database — an orphan object in ` +
    `someone else's bucket. Point NEXT_PUBLIC_SUPABASE_URL at a local Supabase, or set ` +
    `TOVIS_ALLOW_REMOTE_STORAGE_FROM_LOCAL=1 if you really mean it.`
  )
}

// lib/auth/compositeToken.ts
//
// The `<rowId>.<secret>` opaque-token format, extracted from
// lib/auth/passwordReset.ts so the session hand-off (lib/auth/sessionHandoff.ts)
// reuses it instead of shipping a second copy of the same string surgery.
//
// Why the id rides in the token at all: the secret is stored only as a SHA-256
// hash, so a lookup by hash would work — but carrying the row id lets the
// consumer fetch exactly one row by primary key and then compare hashes in
// constant time, rather than making the hash itself the lookup key. The id half
// is not a secret and grants nothing on its own.

export type ParsedCompositeToken = {
  tokenId: string
  secret: string
}

export function buildCompositeToken(args: {
  tokenId: string
  secret: string
}): string {
  return `${args.tokenId}.${args.secret}`
}

/**
 * Split `<rowId>.<secret>`. Returns null for anything that is not exactly that
 * shape — missing separator, empty half, or a blank/absent input. Splits on the
 * FIRST `.` so a secret containing dots is still parsed correctly (our secrets
 * are hex, but the format should not depend on that).
 */
export function parseCompositeToken(
  token: string | null | undefined,
): ParsedCompositeToken | null {
  if (!token) return null

  const trimmed = token.trim()
  if (!trimmed) return null

  const separatorIndex = trimmed.indexOf('.')
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    return null
  }

  const tokenId = trimmed.slice(0, separatorIndex).trim()
  const secret = trimmed.slice(separatorIndex + 1).trim()

  if (!tokenId || !secret) {
    return null
  }

  return { tokenId, secret }
}

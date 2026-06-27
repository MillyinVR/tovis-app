// lib/auth/bearerToken.ts
//
// Single source of truth for extracting a bearer token from an `Authorization`
// header. Pure string logic with no runtime dependencies, so it is safe to
// import from BOTH the Node runtime (getCurrentUser) and the Edge runtime
// (proxy.ts middleware) — keeping the cookie-vs-bearer parsing identical on
// every code path.
//
// Native iOS/Android clients hold the session JWT in secure storage (Keychain /
// Keystore) and present it as `Authorization: Bearer <jwt>` instead of the
// browser-only `tovis_token` cookie. Web stays cookie-based; this is purely an
// additional transport for the same token.

export function parseBearerToken(
  authorizationHeader: string | null | undefined,
): string | null {
  if (!authorizationHeader) return null

  const match = /^Bearer[ \t]+(.+)$/i.exec(authorizationHeader.trim())
  const token = match?.[1]?.trim()

  return token ? token : null
}

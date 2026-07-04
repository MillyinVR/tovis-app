// app/(auth)/_components/social/socialProviders.ts
//
// Client-visible configuration for web social sign-in. Each provider's button
// only renders when its public OAuth client id is set, so the whole feature is
// inert until the credentials are provisioned (like APNs) — no dead buttons.
//
// NEXT_PUBLIC_* vars are inlined at build time, so they must be referenced as
// static `process.env.NEXT_PUBLIC_…` property accesses (not dynamic lookups).

function trimmedOrNull(value: string | undefined): string | null {
  const v = value?.trim()
  return v && v.length > 0 ? v : null
}

/** OAuth web client id for Google Identity Services (matches server GOOGLE_CLIENT_ID). */
export function googleWebClientId(): string | null {
  return trimmedOrNull(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID)
}

/** Apple Services ID for "Sign in with Apple JS" (matches server APPLE_WEB_CLIENT_ID). */
export function appleWebClientId(): string | null {
  return trimmedOrNull(process.env.NEXT_PUBLIC_APPLE_CLIENT_ID)
}

/** True when at least one web social provider is configured. */
export function hasAnySocialProvider(): boolean {
  return googleWebClientId() !== null || appleWebClientId() !== null
}

// lib/auth/clientSignOut.ts
//
// Client-side sign-out. Posts to the logout endpoint (best-effort — a network
// failure still lets the caller redirect to /login, where the missing session
// is re-checked). Shared by the pro account menu and the pro profile account
// section so the one-liner isn't duplicated.

export async function clientSignOut(): Promise<void> {
  await fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => null)
}

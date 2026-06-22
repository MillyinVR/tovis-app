// lib/workspace/mismatch.ts
//
// Client-safe helpers for the "you're in the wrong workspace" flow. The API
// tags a role-gated 403 the current user could resolve by switching with
// `{ code: 'WORKSPACE_MISMATCH', requiredWorkspace }` (see
// app/api/_utils/auth/requireUser.ts). These pure helpers let the global
// interceptor (WorkspaceMismatchProvider) detect that tag and decide whether
// the failed request can be safely auto-retried after the switch.
//
// Kept free of React/DOM so the decision logic is unit-testable in isolation.
import type { Role } from '@prisma/client'

export const WORKSPACE_MISMATCH_CODE = 'WORKSPACE_MISMATCH'

const SWITCHABLE_ROLES: ReadonlySet<string> = new Set<Role>([
  'CLIENT',
  'PRO',
  'ADMIN',
])

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && SWITCHABLE_ROLES.has(value)
}

/**
 * If a response is a role-mismatch the user can resolve by switching, return
 * the workspace they should switch into; otherwise null. Pass the already
 * status code and the parsed JSON body (the caller reads the body off a clone
 * so the original response is left intact for the awaiting fetch).
 */
export function parseWorkspaceMismatch(
  status: number,
  body: unknown,
): Role | null {
  if (status !== 403) return null
  if (typeof body !== 'object' || body === null) return null

  const record = body as Record<string, unknown>
  if (record.code !== WORKSPACE_MISMATCH_CODE) return null

  return isRole(record.requiredWorkspace) ? record.requiredWorkspace : null
}

/**
 * Whether the original request can be safely re-issued verbatim after a
 * workspace switch. We can only replay when the request is addressed by a
 * string/URL (a `Request` object's body stream is consumed by the first send)
 * and its body is a re-readable string (or absent). The overwhelming majority
 * of the app's mutations are `fetch(url, { method, body: JSON.stringify(...) })`,
 * which this covers; uploads (FormData / streams) fall back to a reload.
 */
export function canReplayRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): boolean {
  const addressedByString = typeof input === 'string' || input instanceof URL
  if (!addressedByString) return false

  const body = init?.body
  return body == null || typeof body === 'string'
}

// lib/profiles/profileHrefs.ts
// Single source of truth for building links to a user's public profile, so the
// `/u/[handle]` and `/professionals/[id]` route shapes live in one place.

/**
 * Link to a client's public creator profile, or `null` when the client has not
 * opted into a public identity (no handle / not public). Returning null keeps
 * the PII-safe contract: a non-public client's name renders as plain text.
 */
export function clientPublicProfileHref(client: {
  handle: string | null
  isPublicProfile: boolean
}): string | null {
  const handle = client.handle?.trim()
  if (!client.isPublicProfile || !handle) return null
  return `/u/${encodeURIComponent(handle)}`
}

/** Link to a professional's public profile by ProfessionalProfile id. */
export function professionalProfileHref(professionalId: string): string {
  return `/professionals/${encodeURIComponent(professionalId)}`
}

/**
 * Link to the pro-only client chart (the tabbed "tab view") by ClientProfile id.
 * The page itself hard-gates on `assertProCanViewClient`, so this href is only
 * ever produced for an authorized pro (see resolveClientProfileHref).
 */
export function proClientChartHref(clientProfileId: string): string {
  return `/pro/clients/${encodeURIComponent(clientProfileId)}`
}

export type ClientLinkTarget = {
  clientProfileId: string | null
  handle: string | null
  isPublicProfile: boolean
}

export type ClientLinkViewer = {
  // ClientProfile ids the viewing pro may open (empty when the viewer is not a
  // pro, so non-pros never get a chart link). Built from getVisibleClientIdSetForPro.
  proVisibleClientIds: ReadonlySet<string>
}

/** A viewer with no pro access — only public links resolve. */
export const EMPTY_CLIENT_LINK_VIEWER: ClientLinkViewer = {
  proVisibleClientIds: new Set<string>(),
}

/**
 * THE single rule for "where does a client's name/avatar link go", resolved
 * server-side so the chart id never leaks to unauthorized viewers:
 *   1. viewing pro who can open this client  → /pro/clients/[id] (tab view)
 *   2. otherwise, client opted into a public identity → /u/[handle]
 *   3. otherwise → null (name renders as plain text)
 */
export function resolveClientProfileHref(
  target: ClientLinkTarget,
  viewer: ClientLinkViewer,
): string | null {
  if (
    target.clientProfileId &&
    viewer.proVisibleClientIds.has(target.clientProfileId)
  ) {
    return proClientChartHref(target.clientProfileId)
  }
  return clientPublicProfileHref(target)
}

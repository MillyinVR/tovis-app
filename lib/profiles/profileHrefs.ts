// lib/profiles/profileHrefs.ts
// Single source of truth for building links to a user's public profile, so the
// `/u/[handle]` and `/professionals/[id]` route shapes live in one place.

/**
 * The client's public `@handle`, or `null` when they have no public identity —
 * either they never claimed a handle or they have not opted in. THE one place
 * that collapses the two columns into one answer, so a surface can never check
 * `handle` and forget `isPublicProfile` (which would publish a private client).
 */
export function clientPublicHandle(client: {
  handle: string | null
  isPublicProfile: boolean
}): string | null {
  const handle = client.handle?.trim()
  if (!client.isPublicProfile || !handle) return null
  return handle
}

/**
 * Link to a client's public creator profile, or `null` when the client has not
 * opted into a public identity (no handle / not public). Returning null keeps
 * the PII-safe contract: a non-public client's name renders as plain text.
 */
export function clientPublicProfileHref(client: {
  handle: string | null
  isPublicProfile: boolean
}): string | null {
  const handle = clientPublicHandle(client)
  if (!handle) return null
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

/**
 * The Prisma select fragment `resolveClientProfileHref` needs on a ClientProfile.
 *
 * Spread this into every query whose rows feed a `<ClientProfileLink>`, rather
 * than listing the two fields by hand at each call site — the failure mode this
 * prevents is a surface that selects `id` only, silently resolves every client
 * to "no public profile", and renders inert text that looks exactly like a
 * correctly-refused link.
 */
export const CLIENT_LINK_SELECT = {
  id: true,
  handle: true,
  isPublicProfile: true,
} as const

/** Build a {@link ClientLinkTarget} from a row selected with {@link CLIENT_LINK_SELECT}. */
export function clientLinkTarget(
  client:
    | { id: string; handle: string | null; isPublicProfile: boolean }
    | null
    | undefined,
): ClientLinkTarget {
  return {
    clientProfileId: client?.id ?? null,
    handle: client?.handle ?? null,
    isPublicProfile: client?.isPublicProfile ?? false,
  }
}

export type ClientLinkViewer = {
  // ClientProfile ids the viewing pro may open (empty when the viewer is not a
  // pro, so non-pros never get a chart link). Built from
  // getVisibleClientIdSetForPro for a roster that is booking-scoped by
  // construction, or getChartVisibleClientIdSetForPro when the list can carry
  // rows outside the booking window (booking-less claims) — see the ⚠️ on those
  // two, they are NOT the same question.
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
 *
 * Step 2 is the one that was missing everywhere on the pro side: a surface that
 * only knew rule 1 rendered dead text for every client outside the chart window,
 * including clients whose profile the whole internet can read.
 *
 * Use this when you already hold the batched visible-client set. A page holding
 * a single `getProClientVisibility` result should call
 * {@link clientIdentityHref} with `canOpenChart` instead of synthesising a Set.
 */
export function clientIdentityHref(
  target: ClientLinkTarget,
  canOpenChart: boolean,
): string | null {
  if (canOpenChart && target.clientProfileId) {
    return proClientChartHref(target.clientProfileId)
  }
  return clientPublicProfileHref(target)
}

export function resolveClientProfileHref(
  target: ClientLinkTarget,
  viewer: ClientLinkViewer,
): string | null {
  return clientIdentityHref(
    target,
    target.clientProfileId != null &&
      viewer.proVisibleClientIds.has(target.clientProfileId),
  )
}

/**
 * The same rule again, for a CLIENT component reading an already-gated DTO.
 *
 * The server has by then made both decisions and encoded each as a nullable
 * field, so the browser never has to (and never can) re-derive them:
 *   `clientProfileId`            non-null ⇒ this pro may open the chart
 *   `clientPublicProfileHandle`  non-null ⇒ a public /u/[handle] page exists
 *
 * Both null ⇒ inert text. Use this rather than reading the two fields by hand
 * at a call site — that is where the precedence between them would get flipped.
 */
export function clientIdentityHrefFromDto(dto: {
  clientProfileId: string | null | undefined
  clientPublicProfileHandle: string | null | undefined
}): string | null {
  return clientIdentityHref(
    {
      clientProfileId: dto.clientProfileId ?? null,
      handle: dto.clientPublicProfileHandle ?? null,
      // The route already collapsed opt-in + handle into one field upstream
      // (clientPublicHandle), so a handle present here IS a public profile.
      isPublicProfile: dto.clientPublicProfileHandle != null,
    },
    dto.clientProfileId != null,
  )
}

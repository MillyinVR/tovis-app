// lib/notifications/hrefShapes.ts
//
// The declared set of href SHAPES a notification can carry, and what each one
// is supposed to do when the phone receives it.
//
// ── The weakness this closes ───────────────────────────────────────────────
//
// A notification row's `href` is written here and consumed by tovis-ios's
// `PushDeepLink(href:)`, which switches over path prefixes. The iOS side pinned
// its behaviour with per-href assertions — but those assertions only covered
// the hrefs whoever wrote them knew about. Nothing failed when web added a new
// shape: the parser's `default` arms answer `.clientHome` / `.proHome`, which
// are NOT nil, so the notification centre DISMISSES ITSELF ONTO HOME instead of
// leaving the tap harmless. A dead tap that looks like a working one.
//
// Two independent sweeps missed a shape on the day this was written, so "grep
// harder" is not the fix:
//   - a proximity grep for `href:` near `eventKey:` missed
//     AI_CONSULT_ANALYSIS_READY, because `lib/consult/analysisNotifications.ts`
//     composes `${href}/results` away from its key;
//   - 8 of the `href:` values at `create*Notification` sites are non-literal
//     (`copy.href`, `CHART_SHARE_SETTINGS_HREF`), and 19 further files create
//     notifications without calling `create{Client,Pro,Admin}Notification` at
//     all.
//
// So the set is DECLARED instead of discovered, and the declaration is forced:
// `NOTIFICATION_EVENT_DEFINITIONS` is an exhaustive `Record<NotificationEventKey,
// …>`, and `hrefShapes` is a required field on it. A new event key does not
// compile until it says which shapes it emits (`[]` if none). What keeps the
// declaration HONEST is `assertNotificationHrefShape`, called at every write
// boundary: outside production it throws when an emitted href does not reduce
// to a shape that key declared.
//
// ── surface ────────────────────────────────────────────────────────────────
//
// A flat list of shapes would say a href exists but not what should happen to
// it, and "nothing should happen" is a legitimate answer that must be stated
// rather than defaulted into. Every shape declares one of:
//
//   'native'  the phone opens a specific screen. The iOS test asserts the
//             parser answers something that is NOT nil and NOT `.clientHome` /
//             `.proHome` — i.e. an actual destination.
//   'shell'   the role's home shell IS the honest answer (a bare `/client` with
//             nothing more specific in it). Rare; each one has to argue for
//             itself, because this is also what a dead tap looks like.
//   'web'     the phone must NOT claim it: a token-bearing flow only the web
//             page can complete. The iOS test asserts the parser answers nil,
//             so the tap stays harmless instead of dismissing onto Home.
//
// The 'web' row is the load-bearing one. It is the difference between "the app
// deliberately leaves this alone" and "the app silently swallowed it", and
// nothing in the type system or the parser distinguishes those two.
//
// ── Published to tovis-ios ─────────────────────────────────────────────────
//
// `pnpm gen:notification-href-fixture` writes this to
// `schema/parity/notificationHrefShapes.json`; tovis-ios commits the same bytes
// and drives its REAL parser over every row. `check:ios-parity-fixtures` fails
// here when the two drift. iOS lands first — see that guard's header.

/** What the phone is supposed to do with a href of this shape. */
export type NotificationHrefSurface = 'native' | 'shell' | 'web'

export type NotificationHrefShapeDefinition = {
  /**
   * The shape. Path segments wrapped in `{…}` match any single segment;
   * everything else is literal. A `?` clause lists the query keys that CHANGE
   * THE DESTINATION — `key=value` must match exactly, a bare `key` must merely
   * be present. Query keys the shape does not mention are allowed and ignored,
   * because several emitters decorate a href with analytics-ish extras
   * (`source`, `proTimeZone`, `scheduledFor`) that no parser reads. A `#`
   * clause matches the fragment, with `{…}` again matching freely.
   */
  shape: string
  surface: NotificationHrefSurface
  /** The native destination, for 'native'. Documentation, not asserted here. */
  target?: string
  /** Why this surface, in one line. Required — a bare list explains nothing. */
  why: string
}

/**
 * Every shape a notification href can take.
 *
 * ⚠️ ORDER IS NOT significant for matching (the matcher scores specificity),
 * but it is grouped by surface owner for reading.
 */
export const NOTIFICATION_HREF_SHAPES = [
  // ── Shared: either shell resolves these in place ─────────────────────────
  {
    shape: '/messages/thread/{threadId}',
    surface: 'native',
    target: 'thread',
    why: 'MESSAGE_RECEIVED and the waitlist notices open the conversation.',
  },
  {
    shape: '/looks/{lookPostId}',
    surface: 'native',
    target: 'look',
    why: 'Every look-engagement notice points at the look it is about.',
  },
  {
    shape: '/professionals/{professionalId}',
    surface: 'native',
    target: 'publicPro',
    why: 'The re-engagement nudges send the client back to the pro profile.',
  },

  // ── Client shell ─────────────────────────────────────────────────────────
  {
    shape: '/client/bookings/{bookingId}',
    surface: 'native',
    target: 'booking',
    why: 'The booking detail — payment notices, the AI consult invitation.',
  },
  {
    shape: '/client/bookings/{bookingId}?step=overview',
    surface: 'native',
    target: 'booking(step: "overview")',
    why: 'Appointment reminders and every confirm/reschedule/cancel notice.',
  },
  {
    shape: '/client/bookings/{bookingId}?step=aftercare',
    surface: 'native',
    target: 'booking(step: "aftercare")',
    why: 'AFTERCARE_READY — the aftercare tab of that booking.',
  },
  {
    shape: '/client/bookings/{bookingId}?step=consult',
    surface: 'native',
    target: 'booking(step: "consult")',
    why: 'CONSULTATION_PROPOSAL_SENT — the proposal awaiting a decision.',
  },
  {
    shape: '/client/bookings/{bookingId}#review',
    surface: 'native',
    target: 'booking(step: "review")',
    why: 'REVIEW_REQUESTED. The fragment is folded into `step` by the parser.',
  },
  {
    shape: '/client/consult/{consultSessionId}',
    surface: 'native',
    target: 'clientConsult',
    why: 'LOOK_BRIEF_REVIEW, AI_CONSULT_ANALYSIS_FAILED, the prep reminders.',
  },
  {
    shape: '/client/consult/{consultSessionId}/results',
    surface: 'native',
    target: 'clientConsult',
    why:
      'AI_CONSULT_ANALYSIS_READY — the payoff of the whole consult chain. ' +
      'FOUR path parts: the parser needed a second arm for it, and this is the ' +
      'shape both sweeps missed because it is composed away from its event key.',
  },
  {
    shape: '/client/activity',
    surface: 'native',
    target: 'activity',
    why: 'CLIENT_FOLLOW — the activity feed.',
  },
  {
    shape: '/client/referrals',
    surface: 'native',
    target: 'referrals',
    why: 'REFERRAL_CONFIRMED / REFERRAL_CONVERTED.',
  },
  {
    shape: '/client/referrals?confirm={referralId}',
    surface: 'native',
    target: 'referrals',
    why: 'REFERRAL_TAP_RECEIVED — the referral to confirm.',
  },
  {
    shape: '/client/offers',
    surface: 'native',
    target: 'offers',
    why: 'The waitlist time-offer notice, with no one recipient to float.',
  },
  {
    shape: '/client/offers?accept={recipientId}',
    surface: 'native',
    target: 'offers(accept:)',
    why: 'The priority offer — the id the offers screen floats and highlights.',
  },
  {
    shape: '/client/boards/{boardId}',
    surface: 'native',
    target: 'board',
    why: 'EVENT_DATE_COUNTDOWN, whose body is an instruction to open the board.',
  },
  {
    shape: '/client/settings/chart-sharing',
    surface: 'native',
    target: 'chartAccess',
    why:
      'CHART_ACCESS_REQUESTED — the consent surface that answers the ask. ' +
      '⚠️ Only the path spelling is EMITTED, so only it is declared; rows minted ' +
      'before web split settings into a hub carry `/client/settings` with a ' +
      '`#chart-sharing` fragment instead, and the iOS parser still accepts that. ' +
      'This registry describes what web SENDS, not everything already in the ' +
      'database — do not read the omission as licence to drop the legacy arm.',
  },
  {
    shape: '/offerings/{offeringId}?openingId={openingId}',
    surface: 'native',
    target: 'opening',
    why:
      'LAST_MINUTE_OPENING_AVAILABLE. `openingId` is required, not incidental — ' +
      'the native screen renders one opening, and a bare /offerings/{id} has no ' +
      'native counterpart. The emitter also appends scheduledFor/source/' +
      'proTimeZone, which no parser reads.',
  },
  {
    shape: '/client',
    surface: 'shell',
    target: 'clientHome',
    why:
      'The last-minute job falls back to this when an opening has no offering ' +
      'to point at. There is nothing more specific to open, so the client shell ' +
      'IS the destination rather than a swallowed tap.',
  },

  // ── Client shell, token flows the phone must NOT claim ───────────────────
  //
  // 🔴 These are the reason `surface` exists. Each is a single-use tokenised
  // web flow (`lib/clientActions/linkBuilders.ts` appends the raw token to the
  // registry's `pathPrefix`); the app cannot complete any of them, and the
  // parser's `/client/*` default arm answers `.clientHome` — non-nil — so the
  // notification centre dismisses onto Home and the client never reaches the
  // page the notice was sent to deliver. Answering nil leaves the tap harmless.
  {
    shape: '/claim/{token}',
    surface: 'web',
    why:
      'CLIENT_CLAIM_INVITE. Handled as a Universal LINK by ClaimLink; as a ' +
      'notification href it must stay unclaimed — the token is the whole flow.',
  },
  {
    shape: '/client/rebook/{token}',
    surface: 'web',
    why: 'AFTERCARE_ACCESS — a tokenised aftercare/rebook page, web-only.',
  },
  {
    shape: '/client/deposit/{token}',
    surface: 'web',
    why: 'DEPOSIT_PAYMENT_LINK — a tokenised payment page, web-only.',
  },
  {
    shape: '/client/appointment/{token}',
    surface: 'web',
    why: 'APPOINTMENT_CONFIRMATION — a tokenised confirm/decline page, web-only.',
  },
  {
    shape: '/client/consent/{token}',
    surface: 'web',
    why: 'CONSENT_SIGNATURE — a tokenised consent form, web-only.',
  },
  {
    shape: '/client/consultation/{token}',
    surface: 'web',
    why: 'CONSULTATION_ACTION — a tokenised approve/reject page, web-only.',
  },

  // ── Pro shell ────────────────────────────────────────────────────────────
  {
    shape: '/pro/bookings/{bookingId}',
    surface: 'native',
    target: 'proBooking',
    why: 'The pro-side booking detail — requests, reschedules, payments.',
  },
  {
    shape: '/pro/bookings/{bookingId}?step=consult',
    surface: 'native',
    target: 'proBooking',
    why: 'CONSULTATION_APPROVED / _REJECTED — the client answered the proposal.',
  },
  {
    shape: '/pro/looks/analysis',
    surface: 'native',
    target: 'proLookAnalysis',
    why: 'LOOK_MEDIA_CLARIFICATION opens the signed-in shared look review from the pro shell.',
  },
  {
    shape: '/pro/consults/{consultSessionId}',
    surface: 'native',
    target: 'proConsult',
    why: 'LOOK_BRIEF_REVIEW and CONSULT_PRO_FOLLOW_UP, pro side.',
  },
  {
    shape: '/pro/reviews/{reviewId}',
    surface: 'native',
    target: 'proReviews(id:)',
    why: 'REVIEW_RECEIVED, by path.',
  },
  {
    shape: '/pro/reviews#review-{reviewId}',
    surface: 'native',
    target: 'proReviews(id:)',
    why:
      'The same notice, minted with the web anchor instead. The parser lifts ' +
      'the id out of the fragment, so both spellings scroll to the review.',
  },
  {
    shape: '/pro/profile/public-profile',
    surface: 'native',
    target: 'proProfile',
    why: 'LOOK_FOLLOWER_NEW — the profile the new follower arrived at.',
  },
  {
    shape: '/pro/membership',
    surface: 'native',
    target: 'membership',
    why: 'PRO_HANDLE_RESERVATION_EXPIRING.',
  },
  {
    shape: '/pro/verification',
    surface: 'native',
    target: 'proVerification',
    why: 'The licence-expiry pair — the screen that takes the upload.',
  },
  {
    shape: '/pro/clients/{clientId}',
    surface: 'native',
    target: 'proClient',
    why: 'CHART_ACCESS_GRANTED — "You can now open their chart."',
  },
  {
    shape: '/pro/waitlist',
    surface: 'native',
    target: 'proWaitlist',
    why: 'WAITLIST_CLIENT_LEFT / WAITLIST_OFFER_EXPIRED.',
  },

  // ── Admin ────────────────────────────────────────────────────────────────
  //
  // There is no native admin surface and no plan for one, so every admin href
  // must stay unclaimed. Declared rather than omitted: omission is how a shape
  // goes unnoticed, and `/admin/professionals/{id}` in particular is one path
  // segment away from `/professionals/{id}`, which the app DOES route.
  {
    shape: '/admin/looks/analysis',
    surface: 'web',
    why: 'LOOK_MEDIA_ADMIN_REVIEW opens the privileged web review; there is no native admin shell.',
  },
  {
    shape: '/admin',
    surface: 'web',
    why: 'ADMIN_VIRAL_REQUEST_PENDING. No native admin app.',
  },
  {
    shape: '/admin/professionals/{professionalId}',
    surface: 'web',
    why:
      'ADMIN_VERIFICATION_REVIEW_NEEDED. 🔴 One segment from /professionals/' +
      '{id}, which the app DOES open — claiming it would show an admin the ' +
      'public profile instead of the review queue.',
  },
  {
    shape: '/admin/support/{ticketId}',
    surface: 'web',
    why: 'ADMIN_SUPPORT_TICKET_CREATED. No native admin app.',
  },
  {
    shape: '/admin/invite-codes',
    surface: 'web',
    why: 'ADMIN_USER_SIGNED_UP. No native admin app.',
  },
] as const satisfies readonly NotificationHrefShapeDefinition[]

/** The literal shape strings, as a union — so a declaration cannot invent one. */
export type NotificationHrefShape =
  (typeof NOTIFICATION_HREF_SHAPES)[number]['shape']

type ParsedShape = {
  definition: NotificationHrefShapeDefinition
  segments: readonly string[]
  query: readonly (readonly [string, string | null])[]
  fragment: string | null
  /** Higher wins when several shapes match the same href. */
  specificity: number
}

const WILDCARD = /^\{[^}]+\}$/

function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0)
}

/**
 * Split `/path?query#fragment` into its three parts.
 *
 * Shared by the shape parser and the href matcher so a shape and the href it is
 * meant to describe can never be taken apart two different ways — the bug that
 * would make a shape match nothing while looking correct.
 */
function splitHref(text: string): {
  path: string
  queryText: string
  fragment: string | null
} {
  const hash = text.indexOf('#')
  const fragment = hash === -1 ? null : text.slice(hash + 1)
  const beforeFragment = hash === -1 ? text : text.slice(0, hash)
  const question = beforeFragment.indexOf('?')
  return {
    path: question === -1 ? beforeFragment : beforeFragment.slice(0, question),
    queryText: question === -1 ? '' : beforeFragment.slice(question + 1),
    fragment,
  }
}

function parseShape(definition: NotificationHrefShapeDefinition): ParsedShape {
  const { path, queryText, fragment } = splitHref(definition.shape)
  const query = (queryText ? queryText.split('&') : []).map((clause) => {
    const eq = clause.indexOf('=')
    return eq === -1
      ? ([clause, null] as const)
      : ([clause.slice(0, eq), clause.slice(eq + 1)] as const)
  })
  const segments = splitPath(path)
  return {
    definition,
    segments,
    query,
    fragment,
    // Literal segments beat wildcards, and any query/fragment constraint beats
    // none — so `/client/bookings/{id}?step=aftercare` is preferred over the
    // bare `/client/bookings/{id}` that also matches it.
    specificity:
      segments.filter((s) => !WILDCARD.test(s)).length * 10 +
      query.length * 100 +
      (fragment === null ? 0 : 100),
  }
}

const PARSED: readonly ParsedShape[] = NOTIFICATION_HREF_SHAPES.map(parseShape)
  .slice()
  .sort((a, b) => b.specificity - a.specificity)

function segmentsMatch(
  shape: readonly string[],
  actual: readonly string[],
): boolean {
  if (shape.length !== actual.length) return false
  return shape.every((s, i) => {
    const segment = actual[i]
    if (segment === undefined) return false
    // A wildcard matches any NON-EMPTY segment. Empty would mean a href like
    // `/pro/clients//` reduced to a shape that names a client, and the phone
    // would then fetch a client whose id is the empty string.
    return WILDCARD.test(s) ? segment.length > 0 : s === segment
  })
}

function fragmentMatches(shape: string | null, actual: string | null): boolean {
  if (shape === null) return actual === null || actual.length === 0
  if (actual === null) return false
  // `review-{reviewId}` — literal prefix, then anything non-empty.
  const wildcardAt = shape.indexOf('{')
  if (wildcardAt === -1) return shape === actual
  const prefix = shape.slice(0, wildcardAt)
  return actual.startsWith(prefix) && actual.length > prefix.length
}

/**
 * Reduce a concrete href to the shape it was minted from, or null when it does
 * not match any declared shape.
 *
 * Deliberately pure string work — no URL parsing library, because the values
 * here are already-sanitized internal paths (`normInternalHref`) and a parser
 * that accepted more than the phone's does would defeat the point.
 */
export function notificationHrefShape(
  href: string,
): NotificationHrefShape | null {
  const trimmed = href.trim()
  if (!trimmed.startsWith('/')) return null
  // `splitPath` drops empty segments, so `//evil.example/x` would otherwise
  // collapse to a two-segment path and could be classified as some real shape.
  // `normInternalHref` already refuses protocol-relative URLs upstream; refuse
  // them here too rather than depending on that being true forever. No internal
  // path this repo emits contains a doubled slash.
  if (trimmed.includes('//')) return null

  const { path, queryText, fragment: actualFragment } = splitHref(trimmed)
  const actualSegments = splitPath(path)

  const actualQuery = new Map<string, string>()
  for (const clause of queryText ? queryText.split('&') : []) {
    if (clause.length === 0) continue
    const eq = clause.indexOf('=')
    const key = eq === -1 ? clause : clause.slice(0, eq)
    actualQuery.set(key, eq === -1 ? '' : clause.slice(eq + 1))
  }

  for (const candidate of PARSED) {
    if (!segmentsMatch(candidate.segments, actualSegments)) continue
    if (!fragmentMatches(candidate.fragment, actualFragment)) continue

    const queryOk = candidate.query.every(([key, value]) => {
      if (!actualQuery.has(key)) return false
      if (value === null) return true
      if (WILDCARD.test(value)) return (actualQuery.get(key) ?? '').length > 0
      return actualQuery.get(key) === value
    })
    if (!queryOk) continue

    return candidate.definition.shape as NotificationHrefShape
  }

  return null
}

/** Look a shape's declaration up by its literal string. */
export function notificationHrefShapeDefinition(
  shape: NotificationHrefShape,
): NotificationHrefShapeDefinition {
  const found = NOTIFICATION_HREF_SHAPES.find((s) => s.shape === shape)
  if (!found) {
    throw new Error(`notificationHrefShapeDefinition: unknown shape ${shape}`)
  }
  return found
}

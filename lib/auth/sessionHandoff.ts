// lib/auth/sessionHandoff.ts
//
// One-time sign-in hand-off: an already-authenticated NATIVE session asks for a
// short-lived opaque token, and opening the exchange URL in a browser turns it
// into a normal web session on the way to an allowlisted /pro page.
//
// The problem it solves: iOS opens "Manage plan on the web" in
// SFSafariViewController, which shares SAFARI's cookie jar — it has no idea the
// app is signed in. A pro who is not separately signed in on Safari hits the
// login wall on a button that promised to take them to their plan.
//
// ── The security shape, and why each part is here ──────────────────────────
//
//  1. Opaque + random. `generateTokenHex()` (32 bytes from crypto.randomBytes)
//     — the same generator behind password-reset secrets. Nothing about the
//     token is derived from the user, so it cannot be guessed from knowing who
//     the pro is.
//
//  2. Hashed at rest. Only `sha256Hex(secret)` is stored. Reading the whole
//     table gives an attacker nothing that can mint a session. The comparison
//     is `timingSafeEqualHex`, so a near-miss cannot be walked in by timing.
//
//  3. Single-use, atomically. Consumption is ONE conditional `updateMany`
//     guarded on `usedAt: null`; Postgres serialises the row update, so of two
//     concurrent redemptions exactly one gets `count === 1` and the other gets
//     0 and is refused. There is no read-then-write window to race — which is
//     the whole reason this is not `findFirst` + `update`.
//
//  4. ≤60s TTL. This is a hand-off between two apps on the same device, not a
//     link that gets emailed. Sixty seconds is generous for that and leaves
//     almost no window in which a token sitting in a log or a browser history
//     entry is still live.
//
//  5. User-bound, and bound to the SESSION that asked. `userId` is taken from
//     the authenticated caller, never from the request body. `authVersionAtIssue`
//     pins the session generation: a sign-out-everywhere or password reset
//     inside the window bumps `User.authVersion`, and the exchange then refuses.
//     A hand-off must not be able to outlive the session that authorized it.
//
//  6. No open redirect, by construction. `redirectPath` is validated against the
//     /pro allowlist at ISSUANCE and stored server-side. The exchange reads the
//     destination from the ROW, never from the URL, so at redemption time there
//     is no attacker-supplied destination to sanitize in the first place.
//
// Every one of those is proved in both directions in sessionHandoff.test.ts.

import { Prisma, type Role } from '@prisma/client'

import {
  buildCompositeToken,
  parseCompositeToken,
} from '@/lib/auth/compositeToken'
import {
  generateTokenHex,
  sha256Hex,
  timingSafeEqualHex,
} from '@/lib/auth/timingSafe'
import { readOptionalEnv } from '@/lib/env'
import { prisma } from '@/lib/prisma'

type DbClient = Prisma.TransactionClient | typeof prisma

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

/**
 * Hand-off lifetime. The design brief caps this at 60s and this is the single
 * place it is expressed; the route does not carry its own number.
 */
export const SESSION_HANDOFF_TTL_MS = 60 * 1000

/** Where a hand-off goes when the client does not name a destination. */
export const DEFAULT_SESSION_HANDOFF_PATH = '/pro/membership'

/** Longest destination we will store — matches `redirectPath VARCHAR(512)`. */
const MAX_REDIRECT_PATH_LENGTH = 512

/**
 * Placeholder origin used only to re-parse a candidate path through the URL
 * parser. `.invalid` is reserved by RFC 2606 and can never resolve.
 */
const PATH_PARSE_ORIGIN = 'https://session-handoff.invalid'

/**
 * Validate a hand-off destination against the allowlist.
 *
 * The allowlist is deliberately narrow — the PRO workspace only. This token
 * mints a session, so the set of places it can drop someone is part of its
 * blast radius, and "any internal path" is a bigger surface than the feature
 * needs. Widening it is a deliberate edit here, not something a caller can do.
 *
 * Refused, each with a test on both sides:
 *  - absolute URLs and scheme-relative `//evil.example` (open redirect)
 *  - a backslash, which several browsers normalise to `/` — so `/\evil.example`
 *    would otherwise become protocol-relative
 *  - `..` anywhere, which would climb out of /pro once the browser normalises
 *  - control characters and whitespace (header/URL splitting)
 *  - any non-/pro path, including the near-misses `/professional` and `/pros`
 *
 * Returns the normalised path, or null when it is not allowed. Never throws.
 */
export function sanitizeSessionHandoffPath(
  raw: string | null | undefined,
): string | null {
  if (typeof raw !== 'string') return null

  const candidate = raw.trim()
  if (!candidate) return null
  if (candidate.length > MAX_REDIRECT_PATH_LENGTH) return null

  // Must be a site-root-relative path. `//host` is scheme-relative (an ABSOLUTE
  // url to another origin) and is rejected here before anything else looks at it.
  if (!candidate.startsWith('/')) return null
  if (candidate.startsWith('//')) return null

  // A backslash never appears in a legitimate path of ours, and browsers
  // disagree about whether it means `/`. Refuse rather than guess.
  if (candidate.includes('\\')) return null

  // Control characters (NUL/TAB/CR/LF/…), the space itself, and DEL. CR/LF
  // in particular must never be able to reach a `Location` header.
  if (/[\u0000-\u0020\u007f]/.test(candidate)) return null

  // Any `..` — literal. The encoded forms (`%2e%2e`, `%252e`) are caught by the
  // post-parse pathname check below, which sees the DECODED path.
  if (candidate.includes('..')) return null

  // Re-parse through the URL parser and require that it did not escape the
  // placeholder origin. This is what closes normalisation surprises: whatever
  // the string looked like, we now judge the destination the BROWSER will
  // compute, not the one we hoped for.
  let parsed: URL
  try {
    parsed = new URL(candidate, PATH_PARSE_ORIGIN)
  } catch {
    return null
  }

  if (parsed.origin !== PATH_PARSE_ORIGIN) return null

  const pathname = parsed.pathname
  if (pathname !== '/pro' && !pathname.startsWith('/pro/')) return null

  // Decoded traversal — `/pro/%2e%2e/admin` parses to pathname `/pro/../admin`
  // pre-normalisation on some engines and `/admin` on others. Either way it is
  // not a path we issue, so refuse both.
  if (pathname.includes('..')) return null

  const normalized = `${parsed.pathname}${parsed.search}${parsed.hash}`
  if (normalized.length > MAX_REDIRECT_PATH_LENGTH) return null

  return normalized
}

/** Path of the GET exchange endpoint. The token is the final path segment. */
export const SESSION_HANDOFF_EXCHANGE_PATH = '/api/v1/auth/session-handoff'

const KILL_SWITCH_FLAG = 'DISABLE_SESSION_HANDOFF'

/**
 * Kill switch. Default OFF — the feature works unless someone deliberately
 * turns it off — which is the shape a rollback needs (the opt-IN shape of
 * `ENABLE_PRO_MIGRATION` would be a launch flag, not a way to stop something
 * already live). Same reading as `LOAD_TEST_DISABLE_REAL_DELIVERY`.
 *
 * Why this surface gets one: it MINTS SESSIONS and is user-triggerable. If it
 * ever misbehaves, "wait for a code deploy" is not an acceptable answer.
 *
 * ⚠️ It only counts as a kill switch because flipping it does not strand
 * anyone. Issuance 404s, and the iOS caller (`webHandoffURL`) swallows any
 * failure and opens the plain page URL instead — so the pro still reaches
 * /pro/membership, via the login wall, exactly as they did before this feature
 * existed. Redemption refuses too, so tokens already in flight die rather than
 * outliving the switch.
 */
export function isSessionHandoffDisabled(): boolean {
  const raw = readOptionalEnv(KILL_SWITCH_FLAG)?.trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

/**
 * Build the absolute URL the native client opens in a browser.
 *
 * ── Why the token rides in the PATH and not a fragment ────────────────────
 *
 * A fragment never leaves the browser, which sounds strictly better — but the
 * exchange has to SET A COOKIE, and a fragment is not sent to the server, so
 * redeeming from one requires shipping a JavaScript page that reads
 * `location.hash` and POSTs it back. That trades a server-side secret for one
 * that has been through the DOM, and it puts an HTML page in front of a flow
 * whose entire point is that it is instant. The brief allows this call; this is
 * the reasoning for it.
 *
 * What a path token actually exposes, and why each is covered:
 *  - **Referer.** It does not leak. This endpoint's only response is a redirect;
 *    a browser following one carries the ORIGINAL request's referrer forward
 *    rather than synthesising the redirecting URL as a new one, so the token
 *    never appears as the destination page's `document.referrer` or in the
 *    Referer of any subresource it loads. `Referrer-Policy: no-referrer` is set
 *    on the response regardless, so this does not rest on that subtlety.
 *  - **Browser history / server access logs.** Real, and the same exposure the
 *    repo's existing `/client/consent/<token>` links already carry. It is
 *    answered by lifetime, not by hiding: the token is single-use and dead
 *    within 60 seconds, so a history entry or a log line is a spent credential
 *    by the time anyone reads it.
 *
 * `from` is a NON-authoritative hint used only to build the failure redirect
 * (`/login?from=…`) when the token is unusable and there is therefore no stored
 * destination to fall back on. The SUCCESS path never reads it — it uses the
 * path pinned in the row — and it is re-sanitized through
 * `sanitizeSessionHandoffPath` before use, so it is not an open-redirect
 * surface. Both directions are proved in the route tests.
 */
export function buildSessionHandoffExchangeUrl(args: {
  appUrl: string
  token: string
  fallbackPath: string
}): string {
  const url = new URL(
    `${SESSION_HANDOFF_EXCHANGE_PATH}/${encodeURIComponent(args.token)}`,
    args.appUrl,
  )
  url.searchParams.set('from', args.fallbackPath)
  return url.toString()
}

/**
 * Where an unusable hand-off lands: the ordinary login wall, carrying the
 * destination so login returns the pro to where they were going. Identical for
 * malformed / unknown / expired / reused / wrong-user tokens — the caller must
 * not branch on the reason, so nothing about which one it was is observable.
 */
export function buildSessionHandoffLoginPath(
  fallbackPath: string | null,
): string {
  const target =
    sanitizeSessionHandoffPath(fallbackPath) ?? DEFAULT_SESSION_HANDOFF_PATH
  return `/login?from=${encodeURIComponent(target)}`
}

export type IssuedSessionHandoff = {
  id: string
  /** The full `<rowId>.<secret>` token. Returned ONCE; never stored. */
  token: string
  redirectPath: string
  expiresAt: Date
}

/**
 * Mint a hand-off token for an authenticated user.
 *
 * `redirectPath` must already be sanitized by the caller (the route does it so
 * it can answer 400 with a reason). Passing an unsanitized value throws rather
 * than storing it — a destination that skipped the allowlist must never reach
 * the table, whatever the caller believed.
 *
 * Any of the user's own still-unused tokens are burned first, so a pro tapping
 * the button three times leaves exactly one live token, not three.
 */
export async function createSessionHandoffToken(args: {
  userId: string
  actingRole: Role
  authVersion: number
  redirectPath: string
  ip?: string | null
  userAgent?: string | null
  now?: Date
  tx?: Prisma.TransactionClient
}): Promise<IssuedSessionHandoff> {
  const redirectPath = sanitizeSessionHandoffPath(args.redirectPath)
  if (redirectPath === null) {
    throw new Error(
      'createSessionHandoffToken received a redirect path outside the allowlist.',
    )
  }

  const db = getDb(args.tx)
  const now = args.now ?? new Date()
  const secret = generateTokenHex()
  const tokenHash = sha256Hex(secret)
  const expiresAt = new Date(now.getTime() + SESSION_HANDOFF_TTL_MS)

  await db.sessionHandoffToken.updateMany({
    where: { userId: args.userId, usedAt: null },
    data: { usedAt: now },
  })

  const created = await db.sessionHandoffToken.create({
    data: {
      userId: args.userId,
      tokenHash,
      redirectPath,
      actingRole: args.actingRole,
      authVersionAtIssue: args.authVersion,
      expiresAt,
      issuedIp: args.ip ?? null,
      issuedUserAgent: args.userAgent?.slice(0, 512) ?? null,
    },
    select: { id: true, expiresAt: true, redirectPath: true },
  })

  return {
    id: created.id,
    token: buildCompositeToken({ tokenId: created.id, secret }),
    redirectPath: created.redirectPath,
    expiresAt: created.expiresAt,
  }
}

/**
 * Why a redemption failed. Used for the audit log ONLY — the exchange route
 * answers every one of these identically, so nothing here reaches the browser.
 */
export type SessionHandoffRejection =
  | 'malformed'
  | 'not_found'
  | 'secret_mismatch'
  | 'expired'
  | 'already_used'

export type ConsumeSessionHandoffResult =
  | {
      ok: true
      tokenId: string
      userId: string
      redirectPath: string
      actingRole: Role
      authVersionAtIssue: number
    }
  | { ok: false; reason: SessionHandoffRejection; tokenId: string | null }

/**
 * Validate and CONSUME a hand-off token in one atomic step.
 *
 * Order matters and is deliberate:
 *   1. parse (cheap, no DB)
 *   2. fetch the row by primary key
 *   3. compare the secret in constant time — BEFORE consuming, so a wrong
 *      secret cannot burn somebody else's live token (a trivial denial of
 *      service if it were the other way round)
 *   4. consume with a conditional update that re-asserts `usedAt: null` and
 *      `expiresAt > now` in the WHERE clause. That predicate — not the checks
 *      above it — is what actually makes this single-use: it is evaluated by
 *      Postgres under the row lock, so the expiry/reuse decision cannot be
 *      raced by a second request that read the same row a microsecond earlier.
 *
 * The `expired` / `already_used` distinction reported back is derived from the
 * row AFTER a failed update, purely to make the audit log useful.
 */
export async function consumeSessionHandoffToken(args: {
  rawToken: string | null | undefined
  now?: Date
  tx?: Prisma.TransactionClient
}): Promise<ConsumeSessionHandoffResult> {
  const parsed = parseCompositeToken(args.rawToken)
  if (!parsed) return { ok: false, reason: 'malformed', tokenId: null }

  const db = getDb(args.tx)
  const now = args.now ?? new Date()

  const record = await db.sessionHandoffToken.findUnique({
    where: { id: parsed.tokenId },
    select: {
      id: true,
      userId: true,
      tokenHash: true,
      redirectPath: true,
      actingRole: true,
      authVersionAtIssue: true,
      expiresAt: true,
      usedAt: true,
    },
  })

  if (!record) return { ok: false, reason: 'not_found', tokenId: null }

  if (!timingSafeEqualHex(sha256Hex(parsed.secret), record.tokenHash)) {
    return { ok: false, reason: 'secret_mismatch', tokenId: record.id }
  }

  const consumed = await db.sessionHandoffToken.updateMany({
    where: {
      id: record.id,
      usedAt: null,
      expiresAt: { gt: now },
    },
    data: { usedAt: now },
  })

  if (consumed.count !== 1) {
    return {
      ok: false,
      reason: record.usedAt ? 'already_used' : 'expired',
      tokenId: record.id,
    }
  }

  return {
    ok: true,
    tokenId: record.id,
    userId: record.userId,
    redirectPath: record.redirectPath,
    actingRole: record.actingRole,
    authVersionAtIssue: record.authVersionAtIssue,
  }
}

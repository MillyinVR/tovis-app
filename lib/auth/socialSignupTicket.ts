// lib/auth/socialSignupTicket.ts
//
// The hand-off between "this Google/Apple identity is genuine" and "this person
// now has an account".
//
// ── Why this exists ────────────────────────────────────────────────────────
//
// /api/v1/auth/{google,apple} used to CREATE the account inline, the instant
// the provider's token verified. One verified email became a whole User plus
// ClientProfile, which meant a social signup silently skipped every part of a
// signup that is not the email: the role choice (it hardcoded CLIENT), the
// phone number, transactional-SMS consent, the ZIP or work location, and
// claim-invite adoption. It also collided: a pro who had already booked that
// client owns an UNCLAIMED ClientProfile carrying the same unique email hash,
// so the nested create raised an unhandled P2002 and the client — the single
// most common way a person first appears in this product — got a bare 500.
//
// So the identity is proven at sign-in and the ACCOUNT is created one step
// later, by /api/v1/auth/social/complete, through the same
// createRegisteredAccount() a password signup uses. This module is what carries
// the proven identity across that gap.
//
// ── The security shape, and why each part is here ──────────────────────────
//
// It is lib/auth/sessionHandoff.ts's shape, deliberately — that module's
// header explains each choice at length and this one does not restate it:
//
//  1. Opaque + random: a 32-byte `generateTokenHex()` secret, nothing about it
//     derived from the identity it stands for.
//  2. Hashed at rest (`sha256Hex`), compared with `timingSafeEqualHex`.
//  3. Single-use via ONE conditional `updateMany` guarded on `usedAt: null`,
//     with the expiry re-asserted in the same WHERE clause — so Postgres, under
//     the row lock, is what decides single-use, not a read-then-write window.
//  4. The secret is compared BEFORE consumption, so a wrong guess cannot burn
//     somebody's live ticket.
//
// ── The two ways it deliberately differs ───────────────────────────────────
//
//  • NOT user-bound, and so no `authVersionAtIssue`. A hand-off is minted BY an
//    authenticated session and must not outlive it; a signup ticket is minted
//    when there is no user at all, so there is no session generation to pin to.
//    What binds it instead is the identity stored IN THE ROW: `provider` and
//    `subject` are read from the ticket at completion and never from the
//    request body, so a ticket can only ever create the account for the
//    identity the provider actually authenticated.
//
//  • A longer TTL. Sixty seconds is right for a hand-off between two apps on
//    one device. This one spans a human filling in a form — phone, ZIP, and for
//    a pro a handle, a licence and a work location — so 60s would fail honest
//    people constantly. See SOCIAL_SIGNUP_TICKET_TTL_MS for the number and the
//    reasoning about what a stolen ticket is actually worth.

import { Prisma, type SocialAuthProvider } from '@prisma/client'

import {
  buildCompositeToken,
  parseCompositeToken,
} from '@/lib/auth/compositeToken'
import {
  generateTokenHex,
  sha256Hex,
  timingSafeEqualHex,
} from '@/lib/auth/timingSafe'
import { prisma } from '@/lib/prisma'

type DbClient = Prisma.TransactionClient | typeof prisma

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

/**
 * Ticket lifetime, and the single place it is expressed — no route carries its
 * own number.
 *
 * Fifteen minutes is sized to the SLOWEST honest path: a pro completing signup
 * types a business name, a handle, a licence number and expiry, and picks a
 * work location, with a licence lookup in the middle. A client is far quicker,
 * but the ticket cannot know which it will become — it is issued before the
 * role is chosen.
 *
 * What a stolen ticket is worth, which is what actually caps this: it mints no
 * session and grants access to nothing existing. It permits exactly one thing —
 * creating a NEW account bound to that provider identity, with the thief's own
 * phone and role. That is not nothing (the rightful owner then finds their
 * provider id taken, and must go through support), so it stays minutes rather
 * than hours. It is single-use, so the ordinary case closes it in seconds.
 */
export const SOCIAL_SIGNUP_TICKET_TTL_MS = 15 * 60 * 1000

export type IssuedSocialSignupTicket = {
  id: string
  /** The full `<rowId>.<secret>` token. Returned ONCE; never stored. */
  token: string
  expiresAt: Date
}

/**
 * Park a verified provider identity that has no account yet.
 *
 * Every one of this subject's own still-unused tickets is burned first, so
 * tapping "Continue with Google" three times leaves exactly one live ticket
 * rather than three. Scoped to (provider, subject) — the identity that was just
 * proven — never to the email, so one person's retries can never invalidate a
 * different identity that happens to share a mailbox.
 */
export async function createSocialSignupTicket(args: {
  provider: SocialAuthProvider
  subject: string
  /** Already normalized via normalizeEmail, and asserted verified by the provider. */
  email: string
  firstName: string | null
  lastName: string | null
  tenantId: string
  ip?: string | null
  userAgent?: string | null
  now?: Date
  tx?: Prisma.TransactionClient
}): Promise<IssuedSocialSignupTicket> {
  const db = getDb(args.tx)
  const now = args.now ?? new Date()
  const secret = generateTokenHex()
  const tokenHash = sha256Hex(secret)
  const expiresAt = new Date(now.getTime() + SOCIAL_SIGNUP_TICKET_TTL_MS)

  await db.socialSignupTicket.updateMany({
    where: { provider: args.provider, subject: args.subject, usedAt: null },
    data: { usedAt: now },
  })

  const created = await db.socialSignupTicket.create({
    data: {
      tokenHash,
      provider: args.provider,
      subject: args.subject,
      email: args.email, // pii-plaintext-read-ok: the email from the verified provider token, not a DB read
      firstName: args.firstName,
      lastName: args.lastName,
      tenantId: args.tenantId,
      expiresAt,
      issuedIp: args.ip ?? null,
      issuedUserAgent: args.userAgent?.slice(0, 512) ?? null,
    },
    select: { id: true, expiresAt: true },
  })

  return {
    id: created.id,
    token: buildCompositeToken({ tokenId: created.id, secret }),
    expiresAt: created.expiresAt,
  }
}

/**
 * Why a redemption failed. For the audit log ONLY — the completion route
 * answers every one of these identically, so none of it reaches the browser.
 */
export type SocialSignupTicketRejection =
  | 'malformed'
  | 'not_found'
  | 'secret_mismatch'
  | 'expired'
  | 'already_used'

export type ConsumedSocialSignupTicket = {
  ticketId: string
  provider: SocialAuthProvider
  subject: string
  email: string
  firstName: string | null
  lastName: string | null
  tenantId: string
}

export type ConsumeSocialSignupTicketResult =
  | { ok: true; ticket: ConsumedSocialSignupTicket }
  | { ok: false; reason: SocialSignupTicketRejection; ticketId: string | null }

/**
 * Validate and CONSUME a signup ticket in one atomic step.
 *
 * The order is sessionHandoff's, for its reasons: parse, fetch by primary key,
 * compare the secret in constant time BEFORE consuming, then consume with a
 * conditional update that re-asserts `usedAt: null` and `expiresAt > now` in
 * the WHERE clause. That predicate — evaluated by Postgres under the row lock,
 * not the checks above it — is what makes this single-use.
 *
 * ⚠️ The ticket is consumed here, which means it is spent even if the account
 * creation that follows then fails. That is the deliberate direction to fail
 * in: the alternative (consume after a successful create) leaves a window in
 * which two concurrent completions both pass the check and both try to create
 * an account for one identity. A caller that fails downstream must send the
 * person back through the provider, which costs one tap.
 */
export async function consumeSocialSignupTicket(args: {
  rawToken: string | null | undefined
  now?: Date
  tx?: Prisma.TransactionClient
}): Promise<ConsumeSocialSignupTicketResult> {
  const parsed = parseCompositeToken(args.rawToken)
  if (!parsed) return { ok: false, reason: 'malformed', ticketId: null }

  const db = getDb(args.tx)
  const now = args.now ?? new Date()

  const record = await db.socialSignupTicket.findUnique({
    where: { id: parsed.tokenId },
    select: {
      id: true,
      tokenHash: true,
      provider: true,
      subject: true,
      email: true, // pii-plaintext-read-ok: the ticket's own copy, handed straight to the account it authorizes
      firstName: true, // pii-plaintext-read-ok: the ticket's own copy of a provider-supplied name, handed straight to the account it authorizes
      lastName: true, // pii-plaintext-read-ok: the ticket's own copy of a provider-supplied name, handed straight to the account it authorizes
      tenantId: true,
      expiresAt: true,
      usedAt: true,
    },
  })

  if (!record) return { ok: false, reason: 'not_found', ticketId: null }

  if (!timingSafeEqualHex(sha256Hex(parsed.secret), record.tokenHash)) {
    return { ok: false, reason: 'secret_mismatch', ticketId: record.id }
  }

  const consumed = await db.socialSignupTicket.updateMany({
    where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  })

  if (consumed.count !== 1) {
    return {
      ok: false,
      reason: record.usedAt ? 'already_used' : 'expired',
      ticketId: record.id,
    }
  }

  return {
    ok: true,
    ticket: {
      ticketId: record.id,
      provider: record.provider,
      subject: record.subject,
      email: record.email, // pii-plaintext-read-ok: the ticket's own copy, handed straight to the account it authorizes
      firstName: record.firstName,
      lastName: record.lastName,
      tenantId: record.tenantId,
    },
  }
}

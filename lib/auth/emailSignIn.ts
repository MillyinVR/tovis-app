// lib/auth/emailSignIn.ts
//
// Passwordless email sign-in (OPEN-WORK item 58): "send me a link/code that
// just signs me in". One email carries BOTH a magic link and a 6-digit code,
// and either one redeems the SAME token row.
//
// Why both, in one message (Tori, 2026-08-25): a link opened from an in-app
// browser — Instagram, TikTok — lands in a webview cookie jar that is not the
// person's real browser, so the session it mints is invisible the moment they
// leave the app. That is the exact failure `lib/auth/sessionHandoff.ts` exists
// to work around. The code is the escape hatch: they read six digits and type
// them where they already are.
//
// ── The security shape ─────────────────────────────────────────────────────
// Copied deliberately from `sessionHandoff.ts`, which is this repo's worked
// example of a one-time-token → session exchange. Each property, and why:
//
//  1. Opaque + random link secret. `generateTokenHex()` — 32 bytes of
//     crypto.randomBytes, nothing derived from the user. The 6-digit code is
//     drawn from the same CSPRNG (`randomInt`), never `Math.random`.
//
//  2. Hashed at rest, compared in constant time. Only `sha256Hex` of each
//     credential is stored, and `timingSafeEqualHex` does the comparison so a
//     near-miss cannot be walked in by timing.
//
//     ⚠️ A 6-digit code has only 10^6 preimages, so its hash is brute-forceable
//     OFFLINE by anyone holding a database dump. It is salted with the row id
//     so one leaked hash cannot be replayed against a different row that drew
//     the same digits, but that does not make it uncrackable and is not
//     claimed to. What actually bounds it: a 15-minute TTL, single use, a
//     5-attempt cap, and the fact that an attacker who can already read
//     `EmailVerificationToken` can read `User` too. The code is not the weakest
//     link in that scenario — it is a short-lived credential in a compromise
//     that has already lost.
//
//  3. Single-use, atomically. Consumption is ONE conditional `updateMany`
//     guarded on `usedAt: null` AND `expiresAt > now`. Postgres evaluates that
//     predicate under the row lock, so of two concurrent redemptions exactly
//     one gets `count === 1`. There is deliberately no read-then-write window.
//
//  4. 15-minute TTL. Shorter than password reset's 30 (this mints a session
//     outright rather than gating a second step) and far shorter than email
//     verification's 24h.
//
//  5. One live token per user. Issuing burns the requester's outstanding
//     EMAIL_SIGN_IN tokens, so asking three times leaves one working link, not
//     three — and the two superseded ones are dead rather than lingering.
//
//  6. No `authVersionAtIssue` equivalent, by design. `sessionHandoff` pins the
//     issuing session's generation; here there IS no issuing session — the
//     whole point is that the person is signed out. What replaces it (Tori's
//     decision): a PASSWORD RESET burns every outstanding sign-in token, that
//     being the closest equivalent act of "lock my account down". It is
//     deliberately NOT burned on an ordinary successful sign-in: requesting a
//     link and then signing in another way would silently kill the link already
//     in the inbox, which reads to the person as broken email.
//
//  7. Never signs in on GET. Mail scanners and link-preview bots follow URLs;
//     a single-use token consumed on page load is burned before the human ever
//     clicks. The link lands on a PAGE that requires an explicit button press,
//     which POSTs — the precedent `/verify-email` already sets.

import { AuthVerificationPurpose, Prisma } from '@prisma/client'
import { randomInt } from 'node:crypto'

import {
  buildCompositeToken,
  parseCompositeToken,
} from '@/lib/auth/compositeToken'
import {
  generateTokenHex,
  sha256Hex,
  timingSafeEqualHex,
} from '@/lib/auth/timingSafe'
import { requireEmailEnv } from '@/lib/auth/emailProviderEnv'
import { readOptionalEnv as envOrNull } from '@/lib/env'
import { realDeliverySuppressed } from '@/lib/loadTestDelivery'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { getAuditClientIp } from '@/lib/security/auditClientIp'
import { logAuthEvent } from '@/lib/observability/authEvents'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import type { TenantContext } from '@/lib/tenant/context'

const POSTMARK_SEND_URL = 'https://api.postmarkapp.com/email'

/** See property 4 above. The routes do not carry their own number. */
export const EMAIL_SIGN_IN_EXPIRY_MS = 1000 * 60 * 15 // 15 minutes

/** Human-facing rendering of the TTL. One source, so copy cannot drift. */
export const EMAIL_SIGN_IN_EXPIRY_LABEL = '15 minutes'

/**
 * Wrong-code attempts allowed on a row before it is refused outright.
 * Counted per ROW, not per request, so it survives an attacker rotating IPs —
 * the rate limiter handles volume, this handles guessing a specific code.
 */
export const EMAIL_SIGN_IN_MAX_CODE_ATTEMPTS = 5

const CODE_DIGITS = 6

export { getAppUrlFromRequest as getEmailSignInAppUrlFromRequest } from '@/lib/appUrl'

type DbClient = Prisma.TransactionClient | typeof prisma

function getDb(tx?: Prisma.TransactionClient): DbClient {
  return tx ?? prisma
}

/** @see getAuditClientIp — audit only, never an authorization input. */
export function getEmailSignInRequestIp(request: Request): string | null {
  return getAuditClientIp(request)
}

/**
 * Six digits from the CSPRNG, zero-padded so every code is exactly six
 * characters. `randomInt` is rejection-sampled by Node, so the distribution is
 * uniform — a modulo of `randomBytes` would not be.
 */
export function generateEmailSignInCode(): string {
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, '0')
}

/**
 * Hash a code for storage/comparison, salted with the row it belongs to.
 *
 * The salt is the row id rather than a random column because it is already
 * unique per row and already stored; adding a second column to hold randomness
 * would buy nothing an attacker with the dump does not also get. See the ⚠️ in
 * property 2 for what this does and does not defend against.
 */
export function hashEmailSignInCode(args: {
  tokenId: string
  code: string
}): string {
  return sha256Hex(`${args.tokenId}.${args.code}`)
}

/** Where the emailed link lands. The token is the final path segment. */
export function buildEmailSignInUrl(args: {
  appUrl: string
  token: string
}): string {
  return new URL(
    `/signin/${encodeURIComponent(args.token)}`,
    args.appUrl,
  ).toString()
}

export type IssuedEmailSignIn = {
  id: string
  /** The full `<rowId>.<secret>` link token. Returned ONCE; never stored. */
  token: string
  /** The 6-digit fallback. Returned ONCE; never stored. */
  code: string
  expiresAt: Date
}

/**
 * Mint a sign-in token for a user who has already been resolved from an email.
 *
 * The row is created and then updated with `codeHash` inside one transaction
 * because the hash is salted with the row id, which Postgres does not hand back
 * until the INSERT returns. Both statements share a transaction so a row can
 * never be observed — or redeemed — in the window where its code hash is null.
 */
export async function createEmailSignInToken(args: {
  userId: string
  email: string
  ip?: string | null
  now?: Date
  tx?: Prisma.TransactionClient
}): Promise<IssuedEmailSignIn> {
  const now = args.now ?? new Date()
  const secret = generateTokenHex()
  const tokenHash = sha256Hex(secret)
  const code = generateEmailSignInCode()
  const expiresAt = new Date(now.getTime() + EMAIL_SIGN_IN_EXPIRY_MS)

  const run = async (db: DbClient) => {
    // Property 5: one live token per user.
    await db.emailVerificationToken.updateMany({
      where: {
        userId: args.userId,
        purpose: AuthVerificationPurpose.EMAIL_SIGN_IN,
        usedAt: null,
      },
      data: { usedAt: now },
    })

    const created = await db.emailVerificationToken.create({
      data: {
        userId: args.userId,
        purpose: AuthVerificationPurpose.EMAIL_SIGN_IN,
        email: args.email,
        tokenHash,
        expiresAt,
      },
      select: { id: true, expiresAt: true },
    })

    await db.emailVerificationToken.update({
      where: { id: created.id },
      data: { codeHash: hashEmailSignInCode({ tokenId: created.id, code }) },
      select: { id: true },
    })

    return created
  }

  const created = args.tx
    ? await run(args.tx)
    : await prisma.$transaction((tx) => run(tx))

  void args.ip // audit hook kept in the signature; the row has no ip column

  return {
    id: created.id,
    token: buildCompositeToken({ tokenId: created.id, secret }),
    code,
    expiresAt: created.expiresAt,
  }
}

/**
 * Burn every outstanding sign-in token for a user.
 *
 * Property 6: this is what a PASSWORD RESET calls, and it is the whole of what
 * replaces `authVersionAtIssue`. Returns the number of rows burned so the
 * caller can log it.
 *
 * Takes a `tx` so the caller can make it part of the same transaction that
 * changes the password — a reset that committed while the burn failed would
 * leave live sign-in links for an account whose owner just locked it down.
 */
export async function burnOutstandingEmailSignInTokens(args: {
  userId: string
  now?: Date
  tx?: Prisma.TransactionClient
}): Promise<number> {
  const db = getDb(args.tx)
  const result = await db.emailVerificationToken.updateMany({
    where: {
      userId: args.userId,
      purpose: AuthVerificationPurpose.EMAIL_SIGN_IN,
      usedAt: null,
    },
    data: { usedAt: args.now ?? new Date() },
  })
  return result.count
}

/**
 * Why a redemption failed. Audit only — every route answers these identically,
 * so nothing here is observable by the caller.
 */
export type EmailSignInRejection =
  | 'malformed'
  | 'not_found'
  | 'secret_mismatch'
  | 'expired'
  | 'already_used'
  | 'wrong_purpose'
  | 'too_many_attempts'

export type ConsumeEmailSignInResult =
  | { ok: true; tokenId: string; userId: string }
  | { ok: false; reason: EmailSignInRejection; tokenId: string | null }

/**
 * Validate and CONSUME a magic-link token.
 *
 * Order matters: parse (no DB) → fetch by primary key → constant-time compare
 * the secret BEFORE consuming, so a wrong secret cannot burn somebody else's
 * live token → consume with a conditional update that re-asserts `usedAt: null`
 * and `expiresAt > now`. That predicate, not the checks above it, is what makes
 * this single-use.
 */
export async function consumeEmailSignInLinkToken(args: {
  rawToken: string | null | undefined
  now?: Date
  tx?: Prisma.TransactionClient
}): Promise<ConsumeEmailSignInResult> {
  const parsed = parseCompositeToken(args.rawToken)
  if (!parsed) return { ok: false, reason: 'malformed', tokenId: null }

  const db = getDb(args.tx)
  const now = args.now ?? new Date()

  const record = await db.emailVerificationToken.findUnique({
    where: { id: parsed.tokenId },
    select: {
      id: true,
      userId: true,
      purpose: true,
      tokenHash: true,
      expiresAt: true,
      usedAt: true,
    },
  })

  if (!record) return { ok: false, reason: 'not_found', tokenId: null }

  // A token minted for address verification must never mint a session.
  if (record.purpose !== AuthVerificationPurpose.EMAIL_SIGN_IN) {
    return { ok: false, reason: 'wrong_purpose', tokenId: record.id }
  }

  if (!timingSafeEqualHex(sha256Hex(parsed.secret), record.tokenHash)) {
    return { ok: false, reason: 'secret_mismatch', tokenId: record.id }
  }

  const consumed = await db.emailVerificationToken.updateMany({
    where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  })

  if (consumed.count !== 1) {
    return {
      ok: false,
      reason: record.usedAt ? 'already_used' : 'expired',
      tokenId: record.id,
    }
  }

  return { ok: true, tokenId: record.id, userId: record.userId }
}

/**
 * Validate and CONSUME a 6-digit code for an email address.
 *
 * The code is not unique on its own, so the row is found by (email, purpose,
 * live) — issuance leaves exactly one such row per user, and the newest wins if
 * that invariant is ever violated.
 *
 * A wrong code increments `attempts` on the row and refuses once the cap is
 * reached. That counter is per-row, so it cannot be reset by rotating IPs the
 * way a rate-limit bucket can — the two defend different things and both are
 * needed.
 */
export async function consumeEmailSignInCode(args: {
  email: string
  code: string
  now?: Date
  tx?: Prisma.TransactionClient
}): Promise<ConsumeEmailSignInResult> {
  if (!/^\d{6}$/.test(args.code)) {
    return { ok: false, reason: 'malformed', tokenId: null }
  }

  const db = getDb(args.tx)
  const now = args.now ?? new Date()

  const record = await db.emailVerificationToken.findFirst({
    where: {
      email: args.email,
      purpose: AuthVerificationPurpose.EMAIL_SIGN_IN,
      usedAt: null,
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      userId: true,
      codeHash: true,
      attempts: true,
      expiresAt: true,
      usedAt: true,
    },
  })

  if (!record) return { ok: false, reason: 'not_found', tokenId: null }

  if (record.attempts >= EMAIL_SIGN_IN_MAX_CODE_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts', tokenId: record.id }
  }

  // A row with no code hash cannot be redeemed by code. Refuse rather than
  // treat null as a wildcard.
  if (
    !record.codeHash ||
    !timingSafeEqualHex(
      hashEmailSignInCode({ tokenId: record.id, code: args.code }),
      record.codeHash,
    )
  ) {
    await db.emailVerificationToken.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
      select: { id: true },
    })
    return { ok: false, reason: 'secret_mismatch', tokenId: record.id }
  }

  const consumed = await db.emailVerificationToken.updateMany({
    where: { id: record.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  })

  if (consumed.count !== 1) {
    return {
      ok: false,
      reason: record.usedAt ? 'already_used' : 'expired',
      tokenId: record.id,
    }
  }

  return { ok: true, tokenId: record.id, userId: record.userId }
}

/**
 * Send the one email that carries both credentials.
 *
 * The greeting is generic on purpose: interpolating a user-controlled name into
 * email HTML is an injection surface, and the password-reset mail already sets
 * this precedent.
 */
export async function sendEmailSignInEmail(args: {
  to: string
  signInUrl: string
  code: string
  brandName: string
}): Promise<void> {
  // Load-test kill switch: never hit Postmark for real (fenced off deployed
  // runtimes — see lib/loadTestDelivery).
  if (realDeliverySuppressed()) return

  const apiToken = requireEmailEnv('POSTMARK_SERVER_TOKEN')
  const fromEmail = requireEmailEnv('POSTMARK_FROM_EMAIL')
  const messageStream = envOrNull('POSTMARK_MESSAGE_STREAM')

  const subject = `Your ${args.brandName} sign-in link`
  const text = [
    'Hi there,',
    '',
    `Here is your link to sign in to ${args.brandName}.`,
    '',
    `Open this link: ${args.signInUrl}`,
    '',
    `Or enter this code: ${args.code}`,
    '',
    `This link and code expire in ${EMAIL_SIGN_IN_EXPIRY_LABEL}, and each can be used once.`,
    'If you did not request this, you can ignore this email.',
    '',
    `— The ${args.brandName} team`,
  ].join('\n')

  const html = [
    '<p>Hi there,</p>',
    `<p>Here is your link to sign in to ${args.brandName}.</p>`,
    `<p><a href="${args.signInUrl}">Sign in</a></p>`,
    `<p>Or enter this code: <strong>${args.code}</strong></p>`,
    `<p>This link and code expire in ${EMAIL_SIGN_IN_EXPIRY_LABEL}, and each can be used once.</p>`,
    '<p>If you did not request this, you can ignore this email.</p>',
    `<p>— The ${args.brandName} team</p>`,
  ].join('')

  const payload = {
    From: fromEmail,
    To: args.to,
    Subject: subject,
    TextBody: text,
    HtmlBody: html,
    ...(messageStream ? { MessageStream: messageStream } : {}),
  }

  const response = await fetch(POSTMARK_SEND_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Postmark-Server-Token': apiToken,
    },
    body: JSON.stringify(payload),
    cache: 'no-store',
  })

  const rawText = await response.text()
  let parsed: unknown = null

  try {
    parsed = rawText ? JSON.parse(rawText) : null
  } catch {
    parsed = null
  }

  if (!response.ok) {
    const message =
      isRecord(parsed) && typeof parsed.Message === 'string'
        ? parsed.Message
        : rawText || `Postmark request failed with HTTP ${response.status}.`
    throw new Error(message)
  }

  if (
    isRecord(parsed) &&
    typeof parsed.ErrorCode === 'number' &&
    parsed.ErrorCode !== 0
  ) {
    const message =
      typeof parsed.Message === 'string'
        ? parsed.Message
        : 'Postmark rejected the sign-in email.'
    throw new Error(message)
  }
}

/**
 * Issue a token and send it. Mirrors `issueAndSendPasswordReset`, including the
 * failure handling: if the send throws, the token is burned immediately rather
 * than left live for its full TTL as a credential nobody received.
 */
export async function issueAndSendEmailSignIn(args: {
  userId: string
  email: string
  appUrl: string
  tenantContext: TenantContext
  ip?: string | null
  tx?: Prisma.TransactionClient
}): Promise<{ id: string; expiresAt: Date }> {
  const brand = getBrandForTenantContext(args.tenantContext)
  const issued = await createEmailSignInToken({
    userId: args.userId,
    email: args.email,
    ip: args.ip ?? null,
    tx: args.tx,
  })

  const signInUrl = buildEmailSignInUrl({
    appUrl: args.appUrl,
    token: issued.token,
  })

  try {
    await sendEmailSignInEmail({
      to: args.email,
      signInUrl,
      code: issued.code,
      brandName: brand.displayName,
    })
  } catch (error) {
    await burnOutstandingEmailSignInTokens({ userId: args.userId })
    throw error
  }

  logAuthEvent({
    level: 'info',
    event: 'auth.email_sign_in.email_send.success',
    route: 'auth.emailSignIn.request',
    provider: 'postmark',
    userId: args.userId,
    email: args.email,
    verificationId: issued.id,
  })

  return { id: issued.id, expiresAt: issued.expiresAt }
}

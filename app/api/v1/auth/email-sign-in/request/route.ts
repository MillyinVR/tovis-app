// app/api/v1/auth/email-sign-in/request/route.ts
//
// Passwordless email sign-in — step 1. Send one email carrying both a magic
// link and a 6-digit code.
//
// ENUMERATION SAFETY IS THE WHOLE CONTRACT of this route: it answers
// `{ ok: true }` on EVERY path — bad input, unknown address, ambiguous match,
// missing app URL, Postmark failure, unhandled exception. Anything that
// branches the response on whether an account exists turns this endpoint into
// an account oracle, and it is reachable by anyone. Copied from
// password-reset/request, which holds the same contract.

import { Prisma } from '@prisma/client'

import {
  emailRateLimitKeySuffix,
  enforceRateLimit,
  jsonOk,
  rateLimitIdentity,
} from '@/app/api/_utils'
import { normalizeEmail } from '@/lib/security/contactNormalization'
import {
  getEmailSignInAppUrlFromRequest,
  getEmailSignInRequestIp,
  issueAndSendEmailSignIn,
} from '@/lib/auth/emailSignIn'
import {
  captureAuthException,
  logAuthEvent,
} from '@/lib/observability/authEvents'
import { prisma } from '@/lib/prisma'
import { emailLookupHashV2 } from '@/lib/security/crypto/hashLookup'
import { resolveTenantContextForRequest } from '@/lib/tenant/requestContext'
import type { AuthEmailSignInRequestResponseDTO } from '@/lib/dto/auth'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type Body = {
  email?: unknown
}

const EMAIL_SIGN_IN_USER_SELECT = {
  id: true,
  // pii-plaintext-read-ok: expand-phase parity with password-reset/request — the
  // plaintext column is still the source of truth for the address we MAIL to,
  // and the encrypted envelope is not yet the read path. Lookup is by HMAC.
  email: true,
} satisfies Prisma.UserSelect

type EmailSignInUserRecord = Prisma.UserGetPayload<{
  select: typeof EMAIL_SIGN_IN_USER_SELECT
}>

/**
 * Address lookup goes through the v2 contact HMAC, never a plaintext `email`
 * comparison — the column is encrypted at rest and the hash is the only
 * queryable form.
 */
function buildEmailSignInLookupWhereConditions(
  email: string,
): Prisma.UserWhereInput[] {
  const emailHashV2 = emailLookupHashV2(email)

  if (!emailHashV2) return []

  return [
    {
      emailHashV2: emailHashV2.hash,
      emailHashKeyVersion: emailHashV2.keyVersion,
    },
  ]
}

async function findEmailSignInUserByEmail(
  email: string,
): Promise<EmailSignInUserRecord | null> {
  const users = await prisma.user.findMany({
    where: {
      OR: buildEmailSignInLookupWhereConditions(email),
    },
    select: EMAIL_SIGN_IN_USER_SELECT,
    take: 2,
  })

  if (users.length === 0) return null

  const uniqueUserIds = new Set(users.map((user) => user.id))

  /**
   * If lookup conditions match multiple users, fail closed without revealing
   * anything to the requester. Sign-in must never guess an identity.
   */
  if (uniqueUserIds.size > 1) {
    return null
  }

  return users[0] ?? null
}

/** The single response every path returns. */
function ok() {
  return jsonOk({ ok: true } satisfies AuthEmailSignInRequestResponseDTO, 200)
}

export async function POST(req: Request) {
  let emailForLog: string | null = null
  let userIdForLog: string | null = null

  try {
    const identity = await rateLimitIdentity()

    // Loose per-IP cap — NAT tolerance.
    const rateLimitResponse = await enforceRateLimit({
      bucket: 'auth:email-sign-in:request',
      identity,
    })

    if (rateLimitResponse) return rateLimitResponse

    const body = (await req.json().catch(() => ({}))) as Body
    const email = normalizeEmail(body.email) // pii-plaintext-read-ok: client-supplied address from this request's own body, not a DB read

    emailForLog = email

    if (!email) return ok()

    // Tight IP+email composite — stops one address being flooded, and stops a
    // remote attacker exhausting a specific victim's allowance. Triggers on
    // attempt count only, so a 429 is identical for existing and non-existing
    // accounts and the enumeration-safe contract above is preserved.
    const identityRateLimitResponse = await enforceRateLimit({
      bucket: 'auth:email-sign-in:request:identity',
      identity,
      keySuffix: emailRateLimitKeySuffix(email),
    })

    if (identityRateLimitResponse) return identityRateLimitResponse

    const user = await findEmailSignInUserByEmail(email)

    if (!user) return ok()

    userIdForLog = user.id

    const userEmail = normalizeEmail(user.email) // pii-plaintext-read-ok: the address this email is being SENT to; expand-phase parity with password-reset/request
    emailForLog = userEmail

    if (!userEmail) return ok()

    const appUrl = getEmailSignInAppUrlFromRequest(req)

    if (!appUrl) {
      logAuthEvent({
        level: 'warn',
        event: 'auth.email_sign_in.request.app_url_missing',
        route: 'auth.emailSignIn.request',
        userId: user.id,
        email: userEmail,
        code: 'APP_URL_MISSING',
      })

      return ok()
    }

    await issueAndSendEmailSignIn({
      userId: user.id,
      email: userEmail,
      appUrl,
      tenantContext: await resolveTenantContextForRequest(req),
      ip: getEmailSignInRequestIp(req),
    })

    return ok()
  } catch (error: unknown) {
    /**
     * 🔴 The reporter is wrapped because IT CAN THROW, and if it does it takes
     * the enumeration-safe contract down with it.
     *
     * `captureAuthException` hashes the email through the contact-lookup HMAC
     * keyring, which throws when the keyring is missing or malformed. Observed
     * while driving this route locally: a bad `PII_LOOKUP_HMAC_KEYS_JSON` made
     * this catch block throw, so the route answered 500 instead of `ok`. A
     * misconfigured keyring is a whole-deployment problem, so the 500 would be
     * uniform and not an oracle by itself — but "the guarantee holds unless a
     * dependency of the logger fails" is not a guarantee. The response is
     * decided here, not by the telemetry.
     */
    try {
      captureAuthException({
        event: 'auth.email_sign_in.request.failed',
        route: 'auth.emailSignIn.request',
        code: 'INTERNAL',
        userId: userIdForLog,
        email: emailForLog,
        error,
      })
    } catch {
      // Telemetry is best-effort; the contract is not.
    }

    /**
     * Still OK. A 500 here would be an oracle too: "this address exploded the
     * mailer" is only reachable for an address that has an account.
     */
    return ok()
  }
}

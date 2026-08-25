// app/api/v1/auth/social/complete/route.ts
//
// Second half of a social signup: spend the ticket that /api/v1/auth/{google,
// apple} issued and actually create the account.
//
// ── Why a signup needs a second step at all ────────────────────────────────
//
// A provider proves ONE thing: that this person controls this email address.
// A signup here needs several more that no provider can supply — whether they
// are a client or a pro, a phone number (every booking notification rides on
// it), transactional-SMS consent recorded with its version, IP and user agent,
// a ZIP or a work location, and, for a pro, a handle and a licence. The old
// inline creation had none of that: it minted a CLIENT with no phone and no
// consent, and the person's first booking then had nowhere to send anything.
//
// It also could not adopt a claim invite, which is what made it CRASH. A pro
// who has booked someone already owns an UNCLAIMED ClientProfile holding that
// email's unique hash, so creating a second profile for the same address raised
// an unhandled P2002 and returned a bare 500 to the most ordinary new client
// there is. Here the same two answers a password signup gives are available:
// adopt the existing profile (warm, `intent=CLAIM_INVITE`), or send a claim
// link and refuse (cold) — never collide.
//
// ── What this route is NOT ─────────────────────────────────────────────────
//
// It is not a second entry point into account creation with its own rules. The
// write is createRegisteredAccount(), the same call the register route makes,
// and the differences are confined to the credential (a provider identity, not
// a password), the already-verified email, and the consent source string.

import { ContactMethod, type SocialAuthProvider } from '@prisma/client'
import { waitUntil } from '@vercel/functions'

import {
  enforceRateLimit,
  jsonFail,
  jsonOk,
  phoneRateLimitIdentity,
  pickString,
  rateLimitIdentity,
} from '@/app/api/_utils'
import {
  getRequestHostname,
  resolveCookieDomain,
  resolveIsHttps,
  setSessionCookie,
} from '@/app/api/_utils/auth/sessionCookie'
import { createVerificationToken } from '@/lib/auth'
import { getAppUrlFromRequest } from '@/lib/auth/emailVerification'
import { createRegisteredAccount } from '@/lib/auth/registration/createRegisteredAccount'
import { sendRegistrationVerifications } from '@/lib/auth/registration/sendRegistrationVerifications'
import { isSignupLocationPayload } from '@/lib/auth/registration/signupLocation'
import { consumeSocialSignupTicket } from '@/lib/auth/socialSignupTicket'
import { verifyClaimLinkChannel } from '@/lib/clients/claimLinkChannel'
import {
  findSelfServeClaimableProfile,
  sendSelfServeClaimLink,
} from '@/lib/clients/selfServeClaim'
import type { AuthSocialCompleteResponseDTO } from '@/lib/dto/auth'
import { isRecord } from '@/lib/guards'
import { getCurrentTosVersion } from '@/lib/legal'
import {
  captureAuthException,
  logAuthEvent,
} from '@/lib/observability/authEvents'
import {
  resolveProProfileSetup,
  type ResolvedProProfileSetup,
} from '@/lib/pro/proProfileSetup'
import { isRuntimeFlagEnabled } from '@/lib/runtimeFlags'
import { getAuditClientIp } from '@/lib/security/auditClientIp'
import { normalizePhone } from '@/lib/security/contactNormalization'
import { sanitizeInternalPath } from '@/lib/clientNavigation'
import { validateSmsDestinationCountry } from '@/lib/smsCountryPolicy'
import { resolveTenantContextForRequest } from '@/lib/tenant/requestContext'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { TRANSACTIONAL_SMS_POLICY_VERSION } from '@/lib/transactionalSmsPolicy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function sanitizeOptionalText(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()
  return value || null
}

function normalizeRole(v: unknown): 'CLIENT' | 'PRO' | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'CLIENT') return 'CLIENT'
  if (s === 'PRO') return 'PRO'
  return null
}

/** Consent source, so a social signup is distinguishable in the consent record. */
function consentSource(
  provider: SocialAuthProvider,
  role: 'CLIENT' | 'PRO',
): string {
  return `SOCIAL_SIGNUP_${provider}_${role}`
}

export async function POST(request: Request) {
  try {
    const identity = await rateLimitIdentity()

    // The verified bucket, not the plain one: reaching here requires a ticket,
    // which requires an identity token a provider signed, which is a stronger
    // proof of a human than Turnstile — and is why this route runs no captcha
    // and no App Attest gate of its own. The sign-in route that mints tickets
    // is separately rate-limited per IP.
    const limited = await enforceRateLimit({
      bucket: 'auth:register:verified',
      identity,
    })
    if (limited) return limited

    const rawBody: unknown = await request.json().catch(() => ({}))
    const body = isRecord(rawBody) ? rawBody : {}

    const signupTicket = pickString(body.signupTicket)
    const role = normalizeRole(body.role)
    const rawPhone = pickString(body.phone) // pii-plaintext-read-ok: phone from the signup form's own request body, not a DB read
    const phone = rawPhone ? normalizePhone(rawPhone) : null
    const tosAccepted = body.tosAccepted === true
    const transactionalSmsConsent = body.transactionalSmsConsent === true
    const deviceId = pickString(body.deviceId)
    const tapIntentId = pickString(body.tapIntentId)
    const signupLocation = isSignupLocationPayload(body.signupLocation)
      ? body.signupLocation
      : null
    const nextForVerification = sanitizeInternalPath(pickString(body.next))
    const verificationIntent = sanitizeOptionalText(pickString(body.intent))
    const verificationInviteToken = sanitizeOptionalText(
      pickString(body.inviteToken),
    )
    const claimVerifiedChannel = verifyClaimLinkChannel({
      rawToken: verificationInviteToken,
      via: sanitizeOptionalText(pickString(body.via)),
      sig: sanitizeOptionalText(pickString(body.vsig)),
    })

    if (!signupTicket) {
      return jsonFail(400, 'Missing signup ticket.', { code: 'MISSING_TICKET' })
    }
    if (!role) {
      return jsonFail(400, 'Please choose whether you are a client or a pro.', {
        code: 'MISSING_ROLE',
      })
    }

    // ── Everything a PERSON can get wrong is judged BEFORE the ticket is
    // spent. A ticket is single-use, so burning one on "you forgot your ZIP"
    // would send them back through the provider to fix a typo. The one
    // exception, and why, is marked at the consume below.
    if (!rawPhone) {
      return jsonFail(400, 'Phone number is required.', {
        code: 'PHONE_REQUIRED',
      })
    }
    if (!phone) {
      return jsonFail(400, 'Enter a valid phone number.', {
        code: 'INVALID_PHONE_FORMAT',
      })
    }

    if (await isRuntimeFlagEnabled('signup_disabled')) {
      return jsonFail(503, 'Signup is temporarily unavailable.', {
        code: 'SIGNUP_DISABLED',
      })
    }
    if (await isRuntimeFlagEnabled('sms_disabled')) {
      return jsonFail(503, 'SMS verification is temporarily unavailable.', {
        code: 'SMS_DISABLED',
      })
    }

    const smsCountry = validateSmsDestinationCountry(phone)
    if (!smsCountry.ok) {
      return jsonFail(400, smsCountry.message, {
        code: smsCountry.code,
        countryCode: smsCountry.countryCode,
      })
    }

    if (!tosAccepted) {
      return jsonFail(400, 'You must accept the Terms and Privacy Policy.', {
        code: 'CONSENT_REQUIRED',
      })
    }
    if (!transactionalSmsConsent) {
      return jsonFail(
        400,
        'You must agree to receive transactional SMS messages for account verification and appointment updates.',
        { code: 'SMS_CONSENT_REQUIRED' },
      )
    }

    if (role === 'PRO') {
      if (
        !signupLocation ||
        (signupLocation.kind !== 'PRO_SALON' &&
          signupLocation.kind !== 'PRO_MOBILE')
      ) {
        return jsonFail(400, 'Please confirm your work location.', {
          code: 'PRO_LOCATION_REQUIRED',
        })
      }
    } else if (!signupLocation || signupLocation.kind !== 'CLIENT_ZIP') {
      return jsonFail(400, 'Please confirm your ZIP code.', {
        code: 'CLIENT_ZIP_REQUIRED',
      })
    }

    const finalTimeZone = isValidIanaTimeZone(signupLocation.timeZoneId)
      ? signupLocation.timeZoneId
      : null
    if (!finalTimeZone) {
      return jsonFail(400, 'Unable to determine a valid time zone.', {
        code: 'TIMEZONE_REQUIRED',
      })
    }

    const appUrl = getAppUrlFromRequest(request)
    if (!appUrl) {
      return jsonFail(500, 'App URL is not configured.', {
        code: 'APP_URL_MISSING',
      })
    }

    let tosVersion: string
    try {
      tosVersion = getCurrentTosVersion()
    } catch {
      return jsonFail(500, 'Terms version is not configured.', {
        code: 'TOS_VERSION_MISSING',
      })
    }

    // ⚠️ Resolved HERE, before the ticket is spent, and not next to the write
    // it feeds. A pro has the most to get wrong — handle, licence number,
    // expiry, operating state — and every one of those is a person mistyping a
    // field. Resolving after the consume would burn their single-use ticket on
    // a typo and make them tap the provider again. It reads nothing but the
    // request body, so it has no reason to wait.
    let proSetup: ResolvedProProfileSetup | null = null

    if (role === 'PRO') {
      // Unreachable — the location block above already refused a PRO without a
      // work location. Kept to narrow the union, echoing that block's code so
      // the two can never disagree.
      if (signupLocation.kind === 'CLIENT_ZIP') {
        return jsonFail(400, 'Please confirm your work location.', {
          code: 'PRO_LOCATION_REQUIRED',
        })
      }

      const resolved = await resolveProProfileSetup({
        professionRaw: pickString(body.professionType),
        businessNameRaw: pickString(body.businessName),
        handleRaw: pickString(body.handle),
        licenseStateRaw: pickString(body.licenseState),
        licenseNumberRaw: pickString(body.licenseNumber),
        licenseExpiryRaw: pickString(body.licenseExpiry) ?? null,
        licenseDocumentUrlRaw: pickString(body.licenseDocumentUrl),
        mobileRadiusRaw: body.mobileRadiusMiles,
        location: signupLocation,
      })

      if (!resolved.ok) {
        const { status, message, code, extra } = resolved.failure
        return jsonFail(status, message, { code, ...(extra ?? {}) })
      }

      proSetup = resolved.value
    }

    const phoneIdentity = phoneRateLimitIdentity(phone)
    const smsPhoneHourRes = await enforceRateLimit({
      bucket: 'auth:sms-phone-hour',
      identity: phoneIdentity,
    })
    if (smsPhoneHourRes) return smsPhoneHourRes

    const smsPhoneDayRes = await enforceRateLimit({
      bucket: 'auth:sms-phone-day',
      identity: phoneIdentity,
    })
    if (smsPhoneDayRes) return smsPhoneDayRes

    // ── The ticket. Spent here, and everything below this line is committed to
    // this identity. A single failure answer for every rejection reason —
    // expired, reused, forged, unknown — so nothing about which one it was is
    // observable to a caller probing with guesses.
    const consumed = await consumeSocialSignupTicket({ rawToken: signupTicket })

    if (!consumed.ok) {
      logAuthEvent({
        level: 'warn',
        event: 'auth.social.complete.ticket_rejected',
        route: 'auth.social.complete',
        meta: { reason: consumed.reason, ticketId: consumed.ticketId },
      })
      return jsonFail(
        400,
        'That sign-in has expired. Please start again with Google or Apple.',
        { code: 'INVALID_TICKET' },
      )
    }

    const ticket = consumed.ticket
    const email = ticket.email // pii-plaintext-read-ok: the ticket's own copy of the provider-verified email

    // Names: whatever the person typed on the completion form wins, because the
    // provider's are often wrong or absent — Apple releases a name exactly once
    // and Google's `given_name` can be a handle. The ticket's copy is the
    // fallback for a form that only displayed them.
    const firstName = pickString(body.firstName) || (ticket.firstName ?? '') // pii-plaintext-read-ok: client-supplied name, not a DB read
    const lastName = pickString(body.lastName) || (ticket.lastName ?? '') // pii-plaintext-read-ok: client-supplied name, not a DB read

    // ⚠️ The one refusal below that CAN spend a ticket, because it is the one
    // that cannot be judged from the body alone — it depends on the ticket's
    // fallback names. Reaching it means the provider supplied no name AND the
    // completion form sent none, which is a client defect rather than a person
    // mistyping a field, so the cost (tap the provider again) lands where it
    // belongs. Every user-correctable refusal is above, before the consume.
    if (!firstName || !lastName) {
      return jsonFail(400, 'First and last name are required.', {
        code: 'MISSING_NAME',
      })
    }

    // ⚠️ Read this as the REQUEST's tenant, which is NOT what the account is
    // stamped with. The home tenant comes from `ticket.tenantId` — pinned when
    // the person actually started — so it cannot be swapped between the two
    // steps by completing from a different domain. This context is used only
    // for the two things that are about the request in front of us: which
    // brand sends the claim link, and which brand sends the verifications.
    const tenantContext = await resolveTenantContextForRequest(request)

    // Warm claim: the person arrived from a pro's claim link, so adopt the
    // profile that link points at rather than minting a colliding duplicate.
    // This is the branch that used to be an unhandled P2002.
    const attemptClaimAdopt =
      role === 'CLIENT' &&
      verificationIntent === 'CLAIM_INVITE' &&
      Boolean(verificationInviteToken)

    // Cold claim: no invite in hand, but this contact already has history under
    // an UNCLAIMED profile. Creating an account here would collide on the
    // unique contact hashes — the 500. Send the claim link to the contact ON
    // FILE instead, which is the one path that proves the person is who the
    // profile says. The provider verified the email, but not that this email is
    // the one the pro recorded, so the link still has to go out.
    if (role === 'CLIENT' && !attemptClaimAdopt) {
      const claimable = await findSelfServeClaimableProfile({ email, phone })

      if (claimable) {
        let claimLinkSent = false

        const claimSendLimited = await enforceRateLimit({
          bucket: 'auth:self-serve-claim',
          identity: { kind: 'token', id: claimable.clientId },
        })

        if (!claimSendLimited) {
          try {
            const claimSend = await sendSelfServeClaimLink({
              clientId: claimable.clientId,
              bookingId: claimable.bookingId,
              tenantContext,
            })
            claimLinkSent = claimSend.sent
          } catch (claimErr) {
            captureAuthException({
              event: 'auth.self_serve_claim.send_failed',
              route: 'auth.social.complete',
              email,
              phone,
              error: claimErr,
            })
          }
        }

        return jsonFail(
          409,
          claimLinkSent
            ? 'We found existing history for this contact. Check your email or text for a secure link to finish setting up your account.'
            : 'We found existing history for this contact, but could not send a new secure link just now. Use the link we sent you earlier, or try again in about an hour.',
          {
            code: 'CLAIMABLE_HISTORY',
            maskedDestination: claimable.maskedDestination,
            claimLinkSent,
          },
        )
      }
    }

    const { user, adoptionVerifiedChannel } = await createRegisteredAccount({
      email,
      phone,
      credential: {
        kind: 'SOCIAL',
        provider: ticket.provider,
        subject: ticket.subject,
        // The provider asserted the email; the account is email-verified from
        // the moment it exists and no verification mail is sent.
        emailVerifiedAt: new Date(),
      },
      role,
      firstName,
      lastName,
      tenantId: ticket.tenantId,
      tosVersion,
      timeZone: finalTimeZone,
      location: signupLocation,
      proSetup,
      transactionalSmsConsent: {
        version: TRANSACTIONAL_SMS_POLICY_VERSION,
        source: consentSource(ticket.provider, role),
        ip: getAuditClientIp(request),
        userAgent: request.headers.get('user-agent'),
      },
      attemptClaimAdopt,
      claimInviteToken: verificationInviteToken,
      claimVerifiedChannel,
    })

    if (proSetup?.dcaTimedOutAtSignup) {
      logAuthEvent({
        level: 'warn',
        event: 'auth.dca.timeout',
        route: 'auth.social.complete',
        userId: user.id,
      })
    }

    const phoneVerifiedByClaim = adoptionVerifiedChannel === ContactMethod.SMS

    waitUntil(
      sendRegistrationVerifications({
        route: 'auth.social.complete',
        userId: user.id,
        email,
        phone: user.phone,
        appUrl,
        tenantContext,
        next: nextForVerification,
        intent: verificationIntent,
        inviteToken: verificationInviteToken,
        skipPhoneVerification: phoneVerifiedByClaim,
        // Always: the provider already proved this address. Sending a
        // "confirm your email" mail to an address Google just vouched for is
        // noise, and the account is created with emailVerifiedAt already set.
        skipEmailVerification: true,
        tapIntentId,
      }),
    )

    const token = createVerificationToken({
      userId: user.id,
      role: user.role,
      authVersion: user.authVersion,
      deviceId,
    })

    const res = jsonOk(
      {
        user: { id: user.id, email: user.email, role: user.role },
        token,
        nextUrl: nextForVerification ?? null,
        requiresPhoneVerification: !phoneVerifiedByClaim,
        phoneVerificationSent: phoneVerifiedByClaim ? 'skipped' : 'pending',
        phoneVerificationErrorCode: null,
        requiresEmailVerification: false,
        isPhoneVerified: phoneVerifiedByClaim,
        isEmailVerified: true,
        isFullyVerified: phoneVerifiedByClaim,
        emailVerificationSent: 'skipped',
        needsManualLicenseUpload:
          role === 'PRO' ? (proSetup?.needsManualLicenseUpload ?? false) : false,
        manualLicensePendingReview:
          role === 'PRO'
            ? (proSetup?.manualLicensePendingReview ?? false)
            : false,
      } satisfies AuthSocialCompleteResponseDTO,
      201,
    )

    setSessionCookie({ response: res, request, token })

    if (signupLocation.kind === 'CLIENT_ZIP') {
      const cookieDomain = resolveCookieDomain(getRequestHostname(request))

      res.cookies.set('tovis_client_zip', signupLocation.postalCode, { // pii-plaintext-read-ok: the ZIP the person just typed, echoed to their own browser — parity with the register route
        httpOnly: false,
        secure: resolveIsHttps(request),
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 90,
        ...(cookieDomain ? { domain: cookieDomain } : {}),
      })
    }

    return res
  } catch (err: unknown) {
    captureAuthException({
      event: 'auth.social.complete.failed',
      route: 'auth.social.complete',
      error: err,
    })
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}

// app/api/v1/auth/register/route.ts
import { prisma } from '@/lib/prisma'
import { readOptionalEnv as envOrNull } from '@/lib/env'
import { hashPassword, createVerificationToken } from '@/lib/auth'
import { validatePassword } from '@/lib/passwordPolicy'
import { getCurrentTosVersion } from '@/lib/legal'
import { verifyTurnstileOrFailOpen } from '@/lib/auth/turnstile'
import {
  isNativeRegisterRequest,
  verifyNativeRegistrationGateOrFailOpen,
} from '@/lib/auth/appAttest'
import { consumeTapIntent } from '@/lib/tapIntentConsume'
import {
  getAppUrlFromRequest,
  issueAndSendEmailVerification,
} from '@/lib/auth/emailVerification'
import { resolveTenantContextForRequest } from '@/lib/tenant/requestContext'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { BUCKETS } from '@/lib/storageBuckets'
import {
  jsonFail,
  jsonOk,
  pickString,
  enforceRateLimit,
  rateLimitIdentity,
  phoneRateLimitIdentity,
} from '@/app/api/_utils'
import type { AuthRegisterResponseDTO } from '@/lib/dto/auth'
import { sanitizeInternalPath } from '@/lib/clientNavigation'
import {
  getRequestHostname,
  resolveCookieDomain,
  resolveIsHttps,
  setSessionCookie,
} from '@/app/api/_utils/auth/sessionCookie'
import {
  normalizeEmail,
  normalizePhone,
} from '@/lib/security/contactNormalization'
import { startTwilioVerifyPhoneVerification } from '@/lib/twilio/verify'
import {
  ContactMethod,
  Prisma,
  type ProfessionType,
  VerificationDocumentType,
  VerificationStatus,
} from '@prisma/client'
import { isRuntimeFlagEnabled } from '@/lib/runtimeFlags'
import { isRecord } from '@/lib/guards'
import { isUsStateCode } from '@/lib/usStates'
import {
  requiresLicense,
  supportsOnlineVerification,
} from '@/lib/licensing/licenseRequirement'
import {
  dcaLicenseQueryNumber,
  isCurrentStatusCode,
  licenseNumbersMatch,
  parseDcaLicenseRecord,
} from '@/lib/licensing/caDcaLicense'
import { validateSmsDestinationCountry } from '@/lib/smsCountryPolicy'
import {
  buildProfessionalProfileCreateData,
  createManualLicenseDocData,
  isAnyProfessionType,
  parseMaybeDate,
  resolveProProfileSetup,
  type ResolvedProProfileSetup,
} from '@/lib/pro/proProfileSetup'
import { defaultWorkingHours } from '@/lib/scheduling/workingHoursValidation'
import {
  logAuthEvent,
  captureAuthException,
} from '@/lib/observability/authEvents'
import {
  isHandleReserved,
  isValidHandle,
  normalizeHandle,
} from '@/lib/handles'
import { claimHandle, isHandleAvailable } from '@/lib/handles/registry'
import { waitUntil } from '@vercel/functions'
import { TRANSACTIONAL_SMS_POLICY_VERSION } from '@/lib/transactionalSmsPolicy'

import {
  buildClientProfileContactLookupData,
  buildUserContactLookupData,
} from '@/lib/security/contactLookup'
import { buildPhoneEncryptionWriteData } from '@/lib/security/phonePrivacy'
import { buildEmailEncryptionWriteData } from '@/lib/security/emailPrivacy'
import { buildAddressPrivacyWriteData } from '@/lib/security/addressEncryption'
import { adoptClaimInviteDuringRegistration } from '@/lib/clients/claimAdoption'
import { verifyClaimLinkChannel } from '@/lib/clients/claimLinkChannel'
import {
  findSelfServeClaimableProfile,
  sendSelfServeClaimLink,
} from '@/lib/clients/selfServeClaim'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/* =========================================================
   Types
========================================================= */

type SignupLocation =
  | {
      kind: 'PRO_SALON'
      placeId: string
      formattedAddress: string
      city: string | null
      state: string | null
      postalCode: string | null
      countryCode: string | null
      lat: number
      lng: number
      timeZoneId: string
      name?: string | null
    }
  | {
      kind: 'PRO_MOBILE'
      postalCode: string
      city: string | null
      state: string | null
      countryCode: string | null
      lat: number
      lng: number
      timeZoneId: string
    }
  | {
      kind: 'CLIENT_ZIP'
      postalCode: string
      city: string | null
      state: string | null
      countryCode: string | null
      lat: number
      lng: number
      timeZoneId: string
    }


type RegisterBody = {
  email?: unknown
  password?: unknown
  role?: unknown
  firstName?: unknown
  lastName?: unknown
  phone?: unknown
  tapIntentId?: unknown
  signupLocation?: unknown
  next?: unknown
  intent?: unknown
  inviteToken?: unknown
  // Claim-link channel marker (which channel delivered the link + signature).
  via?: unknown
  vsig?: unknown
  deviceId?: unknown

  // pro fields
  businessName?: unknown
  professionType?: unknown
  handle?: unknown
  mobileRadiusMiles?: unknown

  // license fields
  licenseState?: unknown
  licenseNumber?: unknown
  licenseExpiry?: unknown

  // ✅ optional at signup now
  licenseDocumentUrl?: unknown

  // step 2 hardening
  tosAccepted?: unknown
  transactionalSmsConsent?: unknown
  turnstileToken?: unknown

  // native (iOS) App Attest gate — sent in lieu of turnstileToken; see
  // lib/auth/appAttest.ts. `{ keyId, attestation, timestamp }`.
  appAttest?: unknown
}

/* =========================================================
   Helpers
========================================================= */

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function pickUpper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function sanitizeOptionalText(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()
  return value || null
}

function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.trim()
  if (!forwarded) return null
  const first = forwarded.split(',')[0]?.trim()
  return first || null
}

function getUserAgent(request: Request): string | null {
  const value = request.headers.get('user-agent')?.trim()
  return value || null
}

function normalizeRole(v: unknown): 'CLIENT' | 'PRO' | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'CLIENT') return 'CLIENT'
  if (s === 'PRO') return 'PRO'
  return null
}

function isLocationPayload(v: unknown): v is SignupLocation {
  if (!isRecord(v)) return false

  if (v.kind === 'PRO_SALON') {
    return (
      typeof v.placeId === 'string' &&
      typeof v.formattedAddress === 'string' &&
      typeof v.lat === 'number' &&
      typeof v.lng === 'number' &&
      typeof v.timeZoneId === 'string'
    )
  }

  if (v.kind === 'PRO_MOBILE' || v.kind === 'CLIENT_ZIP') {
    return (
      typeof v.postalCode === 'string' &&
      typeof v.lat === 'number' &&
      typeof v.lng === 'number' &&
      typeof v.timeZoneId === 'string'
    )
  }

  return false
}





/** Accept number or string, return finite number or null */
function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = pickString(v)
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}






function readPrismaUniqueTargets(err: unknown): string[] {
  if (!isRecord(err)) return []

  const code = typeof err.code === 'string' ? err.code : ''
  if (code !== 'P2002') return []

  const meta = isRecord(err.meta) ? err.meta : null
  const rawTarget = meta?.target

  if (Array.isArray(rawTarget)) {
    return rawTarget
      .map((value) => (typeof value === 'string' ? value : ''))
      .filter(Boolean)
  }

  if (typeof rawTarget === 'string' && rawTarget.trim()) {
    return [rawTarget.trim()]
  }

  return []
}

function targetsContainEmailOrPhone(targets: string[]): boolean {
  return targets.some((target) => {
    const lower = target.toLowerCase()
    return lower.includes('email') || lower.includes('phone')
  })
}

function targetsContainHandle(targets: string[]): boolean {
  return targets.some((target) => target.toLowerCase().includes('handle'))
}


/* =========================================================
   Profession rules
========================================================= */




// Licensure requirement is now per (profession, state) — see
// lib/licensing/licenseRequirement.ts. requiresLicense()/supportsOnlineVerification()
// replace the old global CA-only set.


/* =========================================================
   Route
========================================================= */

export async function POST(request: Request) {
  let emailForLog: string | null = null
  let phoneForLog: string | null = null

  try {
    const rawBody: unknown = await request.json().catch(() => ({}))
    const body: RegisterBody = isRecord(rawBody) ? rawBody : {}

    const email = normalizeEmail(body.email)
    const password = pickString(body.password)
    const role = normalizeRole(body.role)

    const firstName = pickString(body.firstName)
    const lastName = pickString(body.lastName)

    const rawPhone = pickString(body.phone)
    const phone = rawPhone ? normalizePhone(rawPhone) : null

    emailForLog = email
    phoneForLog = phone

    const tosAccepted = body.tosAccepted === true
    const transactionalSmsConsent = body.transactionalSmsConsent === true
    const transactionalSmsConsentIp = getClientIp(request)
    const transactionalSmsConsentUserAgent = getUserAgent(request)
    const turnstileToken = pickString(body.turnstileToken)

    const tapIntentId = pickString(body.tapIntentId)
    // Native clients send a stable per-install id so the session can be revoked
    // per-device; it rides the verification token through to the active one.
    const deviceId = pickString(body.deviceId)
    const signupLocation = isLocationPayload(body.signupLocation)
      ? body.signupLocation
      : null
    const nextForVerification = sanitizeInternalPath(pickString(body.next))
    const verificationIntent = sanitizeOptionalText(pickString(body.intent))
    const verificationInviteToken = sanitizeOptionalText(
      pickString(body.inviteToken),
    )
    // The claim link's channel marker (via/vsig), threaded from the delivered
    // link through /claim and the signup form. Resolves to the delivery
    // channel only when the signature validates against the invite token;
    // anything absent or tampered is simply no credit.
    const claimVerifiedChannel = verifyClaimLinkChannel({
      rawToken: verificationInviteToken,
      via: sanitizeOptionalText(pickString(body.via)),
      sig: sanitizeOptionalText(pickString(body.vsig)),
    })

    if (!email || !password || !role) {
      return jsonFail(400, 'Missing required fields.', {
        code: 'MISSING_FIELDS',
      })
    }
    if (!firstName || !lastName) {
      return jsonFail(400, 'First and last name are required.', {
        code: 'MISSING_NAME',
      })
    }

    const passwordError = validatePassword(password)
    if (passwordError) {
      return jsonFail(400, passwordError, { code: 'WEAK_PASSWORD' })
    }

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

    // location enforcement
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
    } else {
      if (!signupLocation || signupLocation.kind !== 'CLIENT_ZIP') {
        return jsonFail(400, 'Please confirm your ZIP code.', {
          code: 'CLIENT_ZIP_REQUIRED',
        })
      }
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

    // Signup tenant = the tenant whose domain served the request
    // (docs/architecture/tenant-model.md): root domain -> tovis-root,
    // white-label custom domain -> that tenant. Stamped onto the new
    // profile as its permanent home tenant.
    const tenantContext = await resolveTenantContextForRequest(request)

    let tosVersion: string
    try {
      tosVersion = getCurrentTosVersion()
    } catch {
      return jsonFail(500, 'Terms version is not configured.', {
        code: 'TOS_VERSION_MISSING',
      })
    }

    const transactionalSmsConsentVersion = TRANSACTIONAL_SMS_POLICY_VERSION

    // Bot/abuse gate. The native app can't render Turnstile, so it proves
    // itself with an Apple App Attest attestation instead (lib/auth/appAttest.ts);
    // the web path is unchanged. Both resolve to the same failOpen semantics used
    // for the rate-limit bucket below.
    let gateFailOpen: boolean
    if (isNativeRegisterRequest(request)) {
      const nativeGate = await verifyNativeRegistrationGateOrFailOpen({
        // The attestation is bound to the RAW email/phone strings the client
        // hashed — read them untransformed (not the normalized values above).
        appAttest: body.appAttest,
        email: typeof body.email === 'string' ? body.email : '',
        phone: typeof body.phone === 'string' ? body.phone : '',
      })

      if (!nativeGate.ok) {
        return jsonFail(400, nativeGate.message, { code: nativeGate.code })
      }

      gateFailOpen = nativeGate.failOpen

      if (nativeGate.failOpen) {
        logAuthEvent({
          level: 'warn',
          event: 'auth.register.native_attest_fail_open',
          route: 'auth.register',
          email,
          phone,
          meta: {
            reason: nativeGate.reason ?? null,
            role,
          },
        })
      }
    } else {
      const captcha = await verifyTurnstileOrFailOpen({
        request,
        token: turnstileToken,
      })

      if (!captcha.ok) {
        return jsonFail(400, captcha.message, { code: captcha.code })
      }

      gateFailOpen = captcha.failOpen

      if (captcha.failOpen) {
        logAuthEvent({
          level: 'warn',
          event: 'auth.register.captcha_fail_open',
          route: 'auth.register',
          email,
          phone,
          meta: {
            captchaEvent: captcha.eventName,
            reason: captcha.reason,
            role,
          },
        })
      }
    }

    const identity = await rateLimitIdentity()

    const registerBucket = gateFailOpen
      ? 'auth:register'
      : 'auth:register:verified'

    const registerRateLimitRes = await enforceRateLimit({
      bucket: registerBucket,
      identity,
    })

    if (registerRateLimitRes) return registerRateLimitRes

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

    // ── Pro fields ────────────────────────────────────────────────────────
    // Validation, licence verification and manual-review staging all live in
    // lib/pro/proProfileSetup so the "become a pro" upgrade door (which adds a
    // pro workspace to an EXISTING account) runs the identical checks. Only the
    // refusal SHAPE differs, and that is translated back to jsonFail below.
    let proSetup: ResolvedProProfileSetup | null = null

    if (role === 'PRO') {
      // Unreachable: the location-enforcement block above already refuses a
      // PRO whose location is not PRO_SALON/PRO_MOBILE. Kept only to narrow the
      // union for the resolver, and it echoes that block's code so the two can
      // never disagree if the order above ever changes.
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


    // Claim-link signup: the real person should ADOPT the pro's existing UNCLAIMED
    // ClientProfile (keeping its bookings, aftercare, addresses, and contact)
    // rather than mint a duplicate that collides on the unique contact hashes and
    // dead-ends with ACCOUNT_EXISTS. When adopting, create the User with NO nested
    // profile and adopt-or-create the profile explicitly below.
    const attemptClaimAdopt =
      role === 'CLIENT' &&
      verificationIntent === 'CLAIM_INVITE' &&
      Boolean(verificationInviteToken)

    // Cold self-serve claim: a normal client signup whose contact matches an
    // existing UNCLAIMED profile would otherwise dead-end on ACCOUNT_EXISTS. Detect
    // it and send a claim link to the on-file contact instead of minting a
    // colliding duplicate. The warm intent=CLAIM_INVITE path adopts directly, so it
    // is excluded here.
    if (role === 'CLIENT' && !attemptClaimAdopt) {
      const claimable = await findSelfServeClaimableProfile({ email, phone })

      if (claimable) {
        // Track whether a link actually entered the send queue — the response
        // below must never promise a message that was rate-limited, refused,
        // or failed. (The banner used to say "check your email" regardless,
        // and the client sat waiting for a message that was never coming.)
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
              route: 'auth.register',
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

    const passwordHash = await hashPassword(password)

    const clientProfileCreateData = {
      homeTenantId: tenantContext.tenantId,
      firstName,
      lastName,
      phone,
      ...buildClientProfileContactLookupData({ email, phone }),
      ...buildEmailEncryptionWriteData({ email }),
      ...buildPhoneEncryptionWriteData({ phone }),
      phoneVerifiedAt: null,
    } satisfies Prisma.ClientProfileUncheckedCreateWithoutUserInput

    const { user, adoptionVerifiedChannel } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          phone,
          ...buildUserContactLookupData({ email, phone }),
          ...buildEmailEncryptionWriteData({ email }),
          ...buildPhoneEncryptionWriteData({ phone }),
          phoneVerifiedAt: null,
          emailVerifiedAt: null,
          password: passwordHash,
          role,
          tosAcceptedAt: new Date(),
          tosVersion,
          transactionalSmsConsentAt: new Date(),
          transactionalSmsConsentVersion,
          transactionalSmsConsentSource:
            role === 'PRO' ? 'WEB_SIGNUP_PRO' : 'WEB_SIGNUP_CLIENT',
          transactionalSmsConsentIp,
          transactionalSmsConsentUserAgent,
          
          clientProfile:
            role === 'CLIENT' && !attemptClaimAdopt
              ? { create: clientProfileCreateData }
              : undefined,

          professionalProfile:
            role === 'PRO' && proSetup && signupLocation.kind !== 'CLIENT_ZIP'
              ? {
                  create: buildProfessionalProfileCreateData({
                    resolved: proSetup,
                    identity: { firstName, lastName, phone },
                    tenantId: tenantContext.tenantId,
                    timeZone: finalTimeZone,
                    location: signupLocation,
                  }),
                }
              : undefined,
        },
        select: {
          id: true,
          email: true,
          role: true,
          phone: true,
          authVersion: true,
        },
      })

      let adoptionVerifiedChannel: ContactMethod | null = null

      if (role === 'CLIENT' && attemptClaimAdopt) {
        const adoption = await adoptClaimInviteDuringRegistration({
          tx,
          token: verificationInviteToken,
          userId: user.id,
          registeredEmail: email,
          registeredPhone: phone,
          verifiedChannel: claimVerifiedChannel,
          now: new Date(),
        })

        // Contact mismatch / invalid / already-claimed invite: fall back to a
        // fresh profile so signup still succeeds (degrades to today's behavior).
        if (!adoption.adopted) {
          await tx.clientProfile.create({
            data: { userId: user.id, ...clientProfileCreateData },
          })
        } else {
          adoptionVerifiedChannel = adoption.verifiedChannelApplied
        }
      }

      // Lock the handle in the same transaction that creates the profile
      // holding it. The pre-check above is advisory; this is what actually
      // refuses a handle a client (or another pro) took in the meantime, and it
      // rolls the whole signup back rather than half-creating an account.
      if (role === 'PRO' && proSetup?.normalizedHandle) {
        const created = await tx.professionalProfile.findUniqueOrThrow({
          where: { userId: user.id },
          select: { id: true },
        })
        await claimHandle(tx, proSetup.normalizedHandle, {
          kind: 'PRO',
          professionalId: created.id,
        })
      }

      return { user, adoptionVerifiedChannel }
    })

    if (proSetup?.dcaTimedOutAtSignup) {
      logAuthEvent({
        level: 'warn',
        event: 'auth.dca.timeout',
        route: 'auth.register',
        userId: user.id,
      })
    }

    const verificationEmail = normalizeEmail(user.email)

    // A claim-link click already verified one channel (the one that delivered
    // the link), so that channel needs no OTP/verification send at all.
    const phoneVerifiedByClaim = adoptionVerifiedChannel === ContactMethod.SMS
    const emailVerifiedByClaim = adoptionVerifiedChannel === ContactMethod.EMAIL

    waitUntil(
      (async () => {
        if (user.phone && !phoneVerifiedByClaim) {
          const phoneVerification =
            await startTwilioVerifyPhoneVerification({
              to: user.phone,
            })

          if (phoneVerification.ok) {
            logAuthEvent({
              level: 'info',
              event: 'auth.phone.verify.start.success',
              route: 'auth.register',
              provider: 'twilio_verify',
              userId: user.id,
              phone: user.phone,
              meta: {
                sid: phoneVerification.sid,
                status: phoneVerification.status,
              },
            })
          } else {
            logAuthEvent({
              level:
                phoneVerification.code === 'TWILIO_VERIFY_NOT_CONFIGURED'
                  ? 'error'
                  : 'warn',
              event: 'auth.phone.verify.start.failed',
              route: 'auth.register',
              provider: 'twilio_verify',
              code: phoneVerification.code,
              userId: user.id,
              phone: user.phone,
              meta: {
                message: phoneVerification.message,
              },
            })
          }
        }

        if (verificationEmail && !emailVerifiedByClaim) {
          try {
            await issueAndSendEmailVerification({
              userId: user.id,
              email: verificationEmail,
              appUrl,
              tenantContext,
              next: nextForVerification,
              intent: verificationIntent,
              inviteToken: verificationInviteToken,
            })

            logAuthEvent({
              level: 'info',
              event: 'auth.email.send.success',
              route: 'auth.register',
              provider: 'postmark',
              userId: user.id,
              email: verificationEmail,
            })
          } catch (emailErr) {
            captureAuthException({
              event: 'auth.email.send.failed',
              route: 'auth.register',
              provider: 'postmark',
              userId: user.id,
              email: verificationEmail,
              error: emailErr,
            })
          }
        }

        await consumeTapIntent({
          tapIntentId,
          userId: user.id,
        }).catch(() => null)
      })().catch((backgroundErr) => {
        captureAuthException({
          event: 'auth.register.background_tail.failed',
          route: 'auth.register',
          userId: user.id,
          email: verificationEmail,
          phone: user.phone,
          error: backgroundErr,
        })
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
        // Native clients persist this in secure storage and replay it as
        // `Authorization: Bearer`. Web uses the httpOnly cookie set below.
        token,
        nextUrl: nextForVerification ?? null,
        requiresPhoneVerification: !phoneVerifiedByClaim,
        phoneVerificationSent: phoneVerifiedByClaim ? 'skipped' : 'pending',
        phoneVerificationErrorCode: null,
        requiresEmailVerification: !emailVerifiedByClaim,
        isPhoneVerified: phoneVerifiedByClaim,
        isEmailVerified: emailVerifiedByClaim,
        isFullyVerified: phoneVerifiedByClaim && emailVerifiedByClaim,
        emailVerificationSent: emailVerifiedByClaim ? 'skipped' : 'pending',

        // ✅ safe flags for the client UX
        needsManualLicenseUpload:
          role === 'PRO' ? (proSetup?.needsManualLicenseUpload ?? false) : false,
        manualLicensePendingReview:
          role === 'PRO' ? (proSetup?.manualLicensePendingReview ?? false) : false,
      } satisfies AuthRegisterResponseDTO,
      201,
    )

    setSessionCookie({ response: res, request, token })

    if (signupLocation.kind === 'CLIENT_ZIP') {
      // Not the session cookie: readable by the client and far longer-lived,
      // so it sets its own attributes — but the domain and secure flag are
      // derived by the same helpers, so it scopes identically.
      const cookieDomain = resolveCookieDomain(getRequestHostname(request))

      res.cookies.set('tovis_client_zip', signupLocation.postalCode, {
        httpOnly: false,
        secure: resolveIsHttps(request), // actual protocol, not NODE_ENV
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 90,
        ...(cookieDomain ? { domain: cookieDomain } : {}),
      })
    }

    return res
  } catch (err: unknown) {
    const uniqueTargets = readPrismaUniqueTargets(err)

    if (targetsContainHandle(uniqueTargets)) {
      return jsonFail(400, 'That handle is already taken.', {
        code: 'HANDLE_IN_USE',
      })
    }

    if (targetsContainEmailOrPhone(uniqueTargets)) {
      return jsonFail(400, 'An account already exists with those details.', {
        code: 'ACCOUNT_EXISTS',
      })
    }

    captureAuthException({
      event: 'auth.register.failed',
      route: 'auth.register',
      email: emailForLog,
      phone: phoneForLog,
      error: err,
    })

    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}
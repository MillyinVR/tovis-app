// app/api/v1/pro/upgrade/route.ts
//
// "Become a pro" — add a professional workspace to an EXISTING client account
// (Tori, 2026-08-23).
//
// The multi-workspace machinery already shipped: one User may hold BOTH a
// ClientProfile and a ProfessionalProfile, `User.role` is the permanent HOME
// role, and POST /api/v1/workspace/switch + the switcher UI already move
// between them. The only thing missing was a door that creates the
// ProfessionalProfile for someone who already has an account — until now the
// sole creation site was the register route, reachable only by a brand-new
// signup. This is that door.
//
// It shares every check with registration through lib/pro/proProfileSetup:
// profession, business name, handle (against the GLOBAL registry — a client can
// already hold one), mobile radius, licence state, the CA BreEZe lookup, and
// manual-review staging. A fork here would be the expensive kind — it would
// bypass the checks that decide whether somebody may legally take bookings.
//
// 🔵 DECISION (flagged for Tori): a successful upgrade flips `User.role` to PRO.
// It has to. Entitlement to *switch into* a workspace you don't call home
// requires an APPROVED profile (lib/auth/workspaces.ts), so a pro whose licence
// is still PENDING could not reach the Pro studio at all if their home role
// stayed CLIENT — the upgrade would look like it did nothing. Flipping mirrors
// exactly what registration does for a brand-new pro (role PRO + PENDING is the
// normal new-pro state, and the pro shell shows the readiness screen). Client
// access is not lost: canActAs(CLIENT) is true for anyone, so the switcher takes
// them back.

import { Role } from '@prisma/client'

import { jsonFail, jsonOk, pickString } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { enforceRateLimit, tokenRateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import { setSessionCookie } from '@/app/api/_utils/auth/sessionCookie'
import { createActiveToken } from '@/lib/auth'
import {
  buildProfessionalProfileCreateData,
  claimHandle,
  parseProNumber,
  resolveProProfileSetup,
  type ProSignupLocation,
} from '@/lib/pro/proProfileSetup'
import { prisma } from '@/lib/prisma'
import { isRecord } from '@/lib/guards'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { resolveTenantContextForRequest } from '@/lib/tenant/requestContext'
import { captureAuthException } from '@/lib/observability/authEvents'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function pickCoord(value: unknown): number | null {
  return parseProNumber(value)
}

/**
 * Accept only the two PRO location shapes. A client ZIP is not a place of
 * business, so it is refused rather than coerced.
 */
function parseProLocation(value: unknown): ProSignupLocation | null {
  if (!isRecord(value)) return null

  const lat = pickCoord(value.lat)
  const lng = pickCoord(value.lng)
  const timeZoneId = pickString(value.timeZoneId)
  if (lat == null || lng == null || !timeZoneId) return null
  if (!isValidIanaTimeZone(timeZoneId)) return null

  const city = pickString(value.city)
  const state = pickString(value.state)
  const countryCode = pickString(value.countryCode)

  if (value.kind === 'PRO_SALON') {
    const placeId = pickString(value.placeId)
    const formattedAddress = pickString(value.formattedAddress)
    if (!placeId || !formattedAddress) return null

    return {
      kind: 'PRO_SALON',
      placeId,
      formattedAddress,
      city,
      state,
      countryCode,
      postalCode: pickString(value.postalCode),
      lat,
      lng,
      timeZoneId,
      name: pickString(value.name),
    }
  }

  if (value.kind === 'PRO_MOBILE') {
    const postalCode = pickString(value.postalCode) // pii-plaintext-read-ok: the PRO's own business base ZIP from the request body; not a DB read
    if (!postalCode) return null

    return {
      kind: 'PRO_MOBILE',
      postalCode,
      city,
      state,
      countryCode,
      lat,
      lng,
      timeZoneId,
    }
  }

  return null
}

export async function POST(request: Request) {
  let userIdForLog: string | null = null

  try {
    // A fully-verified ACTIVE session only. requireUser's default already
    // demands both, which matters here: this grants the ability to take
    // bookings and money, so a half-verified session must not reach it.
    const auth = await requireUser({ roles: [Role.CLIENT] })
    if (!auth.ok) return auth.res

    const user = auth.user
    userIdForLog = user.id

    // Per-user, before any work: the CA BreEZe lookup below is the expensive
    // part and it is reached by an authenticated caller, so the account is the
    // right key.
    const limited = await enforceRateLimit({
      bucket: 'pro:upgrade',
      identity: tokenRateLimitIdentity(user.id),
    })
    if (limited) return limited

    if (user.professionalProfile) {
      return jsonFail(409, 'This account already has a professional profile.', {
        code: 'ALREADY_PRO',
      })
    }

    const body = await readJsonRecord(request)

    const location = parseProLocation(body.signupLocation)
    if (!location) {
      return jsonFail(
        400,
        'Add your salon address or your mobile base to continue.',
        { code: 'LOCATION_INVALID' },
      )
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
      location,
    })

    if (!resolved.ok) {
      const { status, message, code, extra } = resolved.failure
      return jsonFail(status, message, { code, ...(extra ?? {}) })
    }

    const setup = resolved.value
    const tenantContext = await resolveTenantContextForRequest(request)

    // The client's own name/phone carry over — this is the same person, and
    // making them retype it would be the kind of friction this door exists to
    // remove. A phone already verified as a client stays verified.
    const client = user.clientProfile

    const { professionalId } = await prisma.$transaction(async (tx) => {
      const created = await tx.professionalProfile.create({
        data: {
          user: { connect: { id: user.id } },
          ...buildProfessionalProfileCreateData({
            resolved: setup,
            identity: {
              firstName: client?.firstName ?? '',
              lastName: client?.lastName ?? '',
              phone: user.phone,
            },
            tenantId: tenantContext.tenantId,
            timeZone: location.timeZoneId,
            location,
            // Carried over deliberately: they verified this number as a client.
            phoneVerifiedAt: user.phoneVerifiedAt,
          }),
        },
        select: { id: true },
      })

      // Same as registration: the pre-check is advisory, the registry's primary
      // key is what actually decides, and losing the race rolls the whole
      // upgrade back rather than half-creating a pro.
      if (setup.normalizedHandle) {
        await claimHandle(tx, setup.normalizedHandle, {
          kind: 'PRO',
          professionalId: created.id,
        })
      }

      // See the DECISION note at the top of this file.
      await tx.user.update({
        where: { id: user.id },
        data: { role: Role.PRO },
      })

      return { professionalId: created.id }
    })

    // The session's JWT carries the acting role, so it has to be re-minted or
    // the caller keeps browsing as a client until their cookie expires.
    const token = createActiveToken({
      userId: user.id,
      role: Role.PRO,
      authVersion: user.authVersion,
      deviceId: user.deviceId,
    })

    const res = jsonOk(
      {
        ok: true,
        professionalId,
        // Native replays this as a bearer; web uses the cookie set below.
        token,
        verificationStatus: setup.verificationStatus,
        licenseVerified: setup.licenseVerified,
        needsManualLicenseUpload: setup.needsManualLicenseUpload,
        manualLicensePendingReview: setup.manualLicensePendingReview,
        nextUrl: '/pro/calendar',
      },
      201,
    )

    setSessionCookie({ response: res, request, token })

    return res
  } catch (error: unknown) {
    captureAuthException({
      event: 'pro.upgrade.failed',
      route: 'pro.upgrade',
      code: 'INTERNAL',
      userId: userIdForLog,
      error,
    })

    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}

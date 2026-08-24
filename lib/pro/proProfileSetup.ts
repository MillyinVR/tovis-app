// lib/pro/proProfileSetup.ts
//
// The ONE place that turns "someone wants to be a pro" into a validated
// ProfessionalProfile. Two doors reach it and they must behave identically:
//
//   1. POST /api/v1/auth/register with role=PRO  — a brand-new account.
//   2. POST /api/v1/pro/upgrade                  — an EXISTING client account
//      adding a pro workspace (Tori, 2026-08-23).
//
// Before this module the whole thing lived inline in the register route, so the
// upgrade door had nothing to call and would have had to fork ~400 lines of
// licence handling. A fork here is the expensive kind: it silently bypasses the
// per-state service gate, the CA BreEZe check and the manual-review staging that
// decide whether someone may legally take bookings.
//
// Deliberately out of scope: everything about the User row (contact, password,
// session, SMS consent). This module only knows about becoming a professional,
// so the upgrade door can use it without touching an existing account's
// identity.

import {
  Prisma,
  type ProfessionType,
  VerificationDocumentType,
  VerificationStatus,
} from '@prisma/client'

import { defaultWorkingHours } from '@/lib/scheduling/workingHoursValidation'
import { buildAddressPrivacyWriteData } from '@/lib/security/addressEncryption'
import { claimHandle, isHandleAvailable } from '@/lib/handles/registry'
import {
  isHandleReserved,
  isValidHandle,
  normalizeHandle,
} from '@/lib/handles'
import {
  requiresLicense,
  supportsOnlineVerification,
} from '@/lib/licensing/licenseRequirement'
import { verifyCaBbcLicense } from '@/lib/licensing/verifyCaBbcLicense'
import { isUsStateCode } from '@/lib/usStates'
import { BUCKETS } from '@/lib/storageBuckets'


/* ── Pro-signup parsing ──────────────────────────────────────────────────────
   Moved out of app/api/v1/auth/register/route.ts (2026-08-23) so the upgrade
   door reaches the same validation. These are pro-specific, which is why they
   live here rather than in a generic util module. */

export const ALL_PROFESSIONS: ProfessionType[] = [
  'COSMETOLOGIST',
  'BARBER',
  'ESTHETICIAN',
  'MANICURIST',
  'HAIRSTYLIST',
  'ELECTROLOGIST',
  'MASSAGE_THERAPIST',
  'MAKEUP_ARTIST',
]

const ALL_PROFESSIONS_SET = new Set<string>(ALL_PROFESSIONS)

export function isAnyProfessionType(v: string): v is ProfessionType {
  return ALL_PROFESSIONS_SET.has(v)
}

export function normalizeLicenseNumber(v: unknown) {
  const raw = typeof v === 'string' ? v : ''
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

function parseSupabaseRef(
  input: string,
): { bucket: string; path: string } | null {
  const s = input.trim()
  if (!s.startsWith('supabase://')) return null
  const rest = s.slice('supabase://'.length)
  const idx = rest.indexOf('/')
  if (idx <= 0) return null
  const bucket = rest.slice(0, idx).trim()
  const path = rest.slice(idx + 1).trim()
  if (!bucket || !path) return null
  return { bucket, path }
}

function looksLikeLicenseDocRef(s: string) {
  if (!s) return false
  if (s.startsWith('http://') || s.startsWith('https://')) return true
  if (s.startsWith('supabase://')) return Boolean(parseSupabaseRef(s))
  if (s.startsWith('/')) return true
  return false
}

export function validateLicenseDocUrl(
  input: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const s = input.trim()
  if (!looksLikeLicenseDocRef(s)) {
    return { ok: false, error: 'Invalid license document reference.' }
  }

  const ref = parseSupabaseRef(s)
  if (ref && ref.bucket !== BUCKETS.mediaPrivate) {
    return {
      ok: false,
      error: 'Invalid license document (must be private upload).',
    }
  }

  return { ok: true, value: s }
}

export function parseMaybeDate(v: string | null): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d : null
}

/** Accept number or string, return a finite number or null. */
export function parseProNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** A refusal, shaped so a route can hand it straight to jsonFail. */
export type ProProfileSetupFailure = {
  status: number
  message: string
  code: string
  /** Extra fields merged into the error body (e.g. statusCode on a licence miss). */
  extra?: Record<string, unknown>
}

export type ProProfileSetupResult<T> =
  | { ok: true; value: T }
  | { ok: false; failure: ProProfileSetupFailure }

/** The pro-specific location shapes. CLIENT_ZIP can never reach this module. */
export type ProSignupLocation =
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

/** Raw, already-string-coerced input. Callers do their own body parsing. */
export type ProProfileSetupInput = {
  professionRaw: string | null
  businessNameRaw: string | null
  handleRaw: string | null
  licenseStateRaw: string | null
  licenseNumberRaw: string | null
  licenseExpiryRaw: string | null
  licenseDocumentUrlRaw: string | null
  mobileRadiusRaw: unknown
  location: ProSignupLocation
}

/** Everything the create step needs, fully validated. */
export type ResolvedProProfileSetup = {
  profession: ProfessionType
  businessName: string | null
  handleToStore: string | null
  normalizedHandle: string | null
  mobileRadiusMiles: number | null

  verificationStatus: VerificationStatus
  licenseVerified: boolean
  licenseStateToStore: string
  licenseNumberToStore: string | null
  licenseExpiryToStore: Date | null
  licenseVerifiedAtToStore: Date | null
  licenseVerifiedSourceToStore: string | null
  licenseStatusCodeToStore: string | null
  licenseRawJsonToStore: Prisma.InputJsonValue | undefined

  manualLicenseDocUrl: string | null
  /** Surfaced to the caller so it can tell the pro what still needs doing. */
  needsManualLicenseUpload: boolean
  manualLicensePendingReview: boolean
  /** The caller logs this; DCA being slow is an ops signal, not a refusal. */
  dcaTimedOutAtSignup: boolean
}

function fail(
  code: string,
  message: string,
  extra?: Record<string, unknown>,
): { ok: false; failure: ProProfileSetupFailure } {
  return {
    ok: false,
    failure: { status: 400, message, code, ...(extra ? { extra } : {}) },
  }
}

/**
 * Validate the pro fields and resolve licence state, running the CA BreEZe
 * check where it applies. Async because of that lookup.
 *
 * Ordering is deliberate and matches what registration has always done: cheap
 * field validation first, then the network call, then the global handle
 * pre-check last — so a bad profession never spends a DCA request.
 */
export async function resolveProProfileSetup(
  input: ProProfileSetupInput,
): Promise<ProProfileSetupResult<ResolvedProProfileSetup>> {
  // ── profession ────────────────────────────────────────────────────────────
  const professionRaw = input.professionRaw?.trim().toUpperCase() || null
  if (!professionRaw) {
    return fail('PROFESSION_REQUIRED', 'Profession is required for pros.')
  }
  if (!isAnyProfessionType(professionRaw)) {
    return fail('PROFESSION_INVALID', 'Invalid profession type.')
  }
  const profession: ProfessionType = professionRaw

  const businessName = input.businessNameRaw?.trim() || null

  // ── handle ────────────────────────────────────────────────────────────────
  let handleToStore: string | null = null
  let normalizedHandle: string | null = null
  if (input.handleRaw?.trim()) {
    handleToStore = input.handleRaw.trim()
    normalizedHandle = normalizeHandle(handleToStore)
    if (!normalizedHandle || !isValidHandle(normalizedHandle)) {
      return fail('HANDLE_INVALID', 'Handle is invalid.')
    }
    if (isHandleReserved(normalizedHandle)) {
      return fail('HANDLE_RESERVED', 'That handle is reserved.')
    }
  }

  // ── mobile radius ─────────────────────────────────────────────────────────
  let mobileRadiusMiles: number | null = null
  if (input.location.kind === 'PRO_MOBILE') {
    const miles = parseProNumber(input.mobileRadiusRaw)
    if (miles == null) {
      return fail(
        'MOBILE_RADIUS_REQUIRED',
        'Mobile radius (miles) is required for mobile pros.',
      )
    }
    if (miles < 1 || miles > 200) {
      return fail(
        'MOBILE_RADIUS_RANGE',
        'Please enter a mobile radius between 1 and 200 miles.',
      )
    }
    mobileRadiusMiles = Math.round(miles)
  }

  // ── licence ───────────────────────────────────────────────────────────────
  // State is mandatory for every pro — it drives the per-state service gate
  // (loadAllowedServices keys off licenseState), not only licence checks.
  let verificationStatus: VerificationStatus = VerificationStatus.PENDING
  let licenseVerified = false
  let licenseNumberToStore: string | null = null
  let licenseExpiryToStore: Date | null = null
  let licenseVerifiedAtToStore: Date | null = null
  let licenseVerifiedSourceToStore: string | null = null
  let licenseStatusCodeToStore: string | null = null
  let licenseRawJsonToStore: Prisma.InputJsonValue | undefined = undefined
  let manualLicenseDocUrl: string | null = null
  let needsManualLicenseUpload = false
  let manualLicensePendingReview = false
  let dcaTimedOutAtSignup = false

  const licenseState = input.licenseStateRaw?.trim().toUpperCase() || null
  if (!licenseState) {
    return fail(
      'STATE_REQUIRED',
      'Please select the state you’re licensed/operating in.',
    )
  }
  if (!isUsStateCode(licenseState)) {
    return fail('STATE_INVALID', 'Please select a valid US state.')
  }

  // Stage the attestation + manual-review path (optional doc now, otherwise
  // uploaded later on the Verification page). The account stays usable.
  const stageManualReview = (
    note: string,
    extra: Prisma.JsonObject,
  ): string | null => {
    const docUrlRaw = input.licenseDocumentUrlRaw
    if (docUrlRaw?.trim()) {
      const checked = validateLicenseDocUrl(docUrlRaw)
      if (!checked.ok) return checked.error
      manualLicenseDocUrl = checked.value
      manualLicensePendingReview = true
    } else {
      needsManualLicenseUpload = true
    }
    verificationStatus = VerificationStatus.PENDING
    licenseVerified = false
    licenseRawJsonToStore = {
      note,
      needsManualUpload: needsManualLicenseUpload,
      docProvidedAtSignup: Boolean(manualLicenseDocUrl),
      ...extra,
    } satisfies Prisma.InputJsonValue
    return null
  }

  if (requiresLicense(profession, licenseState)) {
    const licenseNumber = normalizeLicenseNumber(input.licenseNumberRaw)
    if (!licenseNumber) {
      return fail(
        'LICENSE_REQUIRED',
        'A license or registration number is required for this profession in your state.',
      )
    }
    licenseNumberToStore = licenseNumber
    // Pro-entered expiry (optional at signup; required before approval).
    // CA online verify overrides this with the official BreEZe date below.
    licenseExpiryToStore = parseMaybeDate(input.licenseExpiryRaw)

    if (supportsOnlineVerification(profession, licenseState)) {
      const v = await verifyCaBbcLicense({
        professionType: profession,
        licenseNumber,
      })

      if (v.ok && v.verified) {
        verificationStatus = VerificationStatus.APPROVED
        licenseVerified = true
        licenseExpiryToStore = parseMaybeDate(v.expDate ?? null)
        licenseVerifiedAtToStore = new Date()
        licenseVerifiedSourceToStore = v.source
        licenseStatusCodeToStore = v.statusCode ?? null
        licenseRawJsonToStore = v.raw
      } else if (v.ok && !v.verified) {
        return fail(
          'LICENSE_NOT_VERIFIED',
          'License could not be verified as CURRENT.',
          { statusCode: v.statusCode ?? null },
        )
      } else if (v.reason === 'TIMEOUT') {
        dcaTimedOutAtSignup = true
        verificationStatus = VerificationStatus.PENDING
        licenseVerified = false
        licenseRawJsonToStore = {
          note: 'DCA timeout at signup',
          error: 'AbortError',
        } satisfies Prisma.InputJsonValue
      } else {
        // Everything that is not a clean read of this pro's own record ends up
        // in front of an admin instead of bouncing the signup.
        const note =
          v.reason === 'NUMBER_MISMATCH'
            ? 'DCA record did not match the submitted license number; manual review required'
            : v.reason === 'UNREADABLE'
              ? 'DCA response was not a readable license record; manual review required'
              : 'DCA unavailable at signup; manual follow-up required'

        const err = stageManualReview(note, {
          error: v.error ?? null,
          ...(v.details ?? {}),
        })
        if (err) return fail('LICENSE_DOC_INVALID', err)
      }
    } else {
      // Out-of-state / specialty credential: no online verifier yet →
      // attestation + async admin review.
      const err = stageManualReview(
        'Out-of-state/specialty credential; manual review required',
        { state: licenseState },
      )
      if (err) return fail('LICENSE_DOC_INVALID', err)
    }
  }

  // Handle uniqueness — against the GLOBAL namespace, not just other pros. A
  // client can hold a handle too, and the looks feed renders both as the same
  // `@handle`. This is the friendly pre-check; the registry's primary key is
  // what actually decides, inside the caller's transaction.
  if (normalizedHandle) {
    const available = await isHandleAvailable(normalizedHandle)
    if (!available) {
      return fail('HANDLE_IN_USE', 'That handle is already taken.')
    }
  }

  return {
    ok: true,
    value: {
      profession,
      businessName,
      handleToStore,
      normalizedHandle,
      mobileRadiusMiles,
      verificationStatus,
      licenseVerified,
      licenseStateToStore: licenseState,
      licenseNumberToStore,
      licenseExpiryToStore,
      licenseVerifiedAtToStore,
      licenseVerifiedSourceToStore,
      licenseStatusCodeToStore,
      licenseRawJsonToStore,
      manualLicenseDocUrl,
      needsManualLicenseUpload,
      manualLicensePendingReview,
      dcaTimedOutAtSignup,
    },
  }
}

/**
 * Build the ProfessionalProfile create payload (without `user`, so it works
 * both as a nested create under a new User and as a standalone create for an
 * existing one).
 *
 * 🔴 `paymentSettings: { create: {} }` is load-bearing, not tidiness: a pro with
 * no payment-settings row accepts NO payment method, so the session wrap-up
 * offers no "Mark as paid" control and their first booking can never be closed
 * out — while the Payment settings screen shows "Cash" ticked, because the
 * editor falls back to these same schema defaults (OPEN-WORK item 52, #981).
 */
export function buildProfessionalProfileCreateData(args: {
  resolved: ResolvedProProfileSetup
  identity: { firstName: string; lastName: string; phone: string | null }
  tenantId: string
  timeZone: string
  location: ProSignupLocation
  /** Carried over on an upgrade so a verified phone is not silently reset. */
  phoneVerifiedAt?: Date | null
}): Prisma.ProfessionalProfileCreateWithoutUserInput {
  const { resolved, identity, location, timeZone } = args

  const locationCreate =
    location.kind === 'PRO_SALON'
      ? {
          type: 'SALON' as const,
          name: location.name ?? null,
          isPrimary: true,
          isBookable: false,
          formattedAddress: location.formattedAddress,
          city: location.city,
          state: location.state,
          postalCode: location.postalCode,
          countryCode: location.countryCode,
          placeId: location.placeId,
          lat: location.lat,
          lng: location.lng,
          ...buildAddressPrivacyWriteData({
            formattedAddress: location.formattedAddress,
            addressLine1: null,
            addressLine2: null,
            city: location.city,
            state: location.state,
            postalCode: location.postalCode,
            countryCode: location.countryCode,
            placeId: location.placeId,
            lat: location.lat,
            lng: location.lng,
          }),
          timeZone,
          workingHours: defaultWorkingHours(),
        }
      : {
          type: 'MOBILE_BASE' as const,
          name: 'Mobile base',
          isPrimary: true,
          isBookable: false,
          city: location.city,
          state: location.state,
          postalCode: location.postalCode,
          countryCode: location.countryCode,
          lat: location.lat,
          lng: location.lng,
          ...buildAddressPrivacyWriteData({
            formattedAddress: null,
            addressLine1: null,
            addressLine2: null,
            city: location.city,
            state: location.state,
            postalCode: location.postalCode,
            countryCode: location.countryCode,
            placeId: null,
            lat: location.lat,
            lng: location.lng,
          }),
          timeZone,
          workingHours: defaultWorkingHours(),
        }

  return {
    homeTenant: { connect: { id: args.tenantId } },
    firstName: identity.firstName,
    lastName: identity.lastName,
    phone: identity.phone,
    phoneVerifiedAt: args.phoneVerifiedAt ?? null,
    timeZone,

    bio: '',
    location: '',

    businessName: resolved.businessName,
    handle: resolved.handleToStore,
    handleNormalized: resolved.normalizedHandle,

    professionType: resolved.profession,

    licenseNumber: resolved.licenseNumberToStore,
    licenseState: resolved.licenseStateToStore,
    licenseExpiry: resolved.licenseExpiryToStore,
    licenseVerified: resolved.licenseVerified,
    verificationStatus: resolved.verificationStatus,

    licenseVerifiedAt: resolved.licenseVerifiedAtToStore,
    licenseVerifiedSource: resolved.licenseVerifiedSourceToStore,
    licenseStatusCode: resolved.licenseStatusCodeToStore,

    // Omit when undefined (prevents exactOptionalPropertyTypes pain).
    ...(resolved.licenseRawJsonToStore !== undefined
      ? { licenseRawJson: resolved.licenseRawJsonToStore }
      : {}),

    mobileBasePostalCode:
      location.kind === 'PRO_MOBILE' ? location.postalCode : null, // pii-plaintext-read-ok: the PRO's own business base ZIP from their signup input, stored as a business attribute; not a DB read of anyone's private address
    mobileRadiusMiles:
      location.kind === 'PRO_MOBILE' ? resolved.mobileRadiusMiles : null,

    locations: { create: locationCreate },

    verificationDocs: resolved.manualLicenseDocUrl
      ? { create: createManualLicenseDocData(resolved.manualLicenseDocUrl) }
      : undefined,

    paymentSettings: { create: {} },
  }
}

/** The staged manual-review document row for a licence awaiting an admin. */
export function createManualLicenseDocData(urlOrRef: string) {
  return {
    type: VerificationDocumentType.LICENSE,
    label: 'License (manual review)',
    url: urlOrRef,
    status: VerificationStatus.PENDING,
  }
}

/** Re-exported so callers claim the handle without importing the registry. */
export { claimHandle }

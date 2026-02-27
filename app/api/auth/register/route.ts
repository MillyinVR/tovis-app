// app/api/auth/register/route.ts
import { prisma } from '@/lib/prisma'
import { hashPassword, createToken } from '@/lib/auth'
import { consumeTapIntent } from '@/lib/tapIntentConsume'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { jsonFail, jsonOk, pickString, normalizeEmail } from '@/app/api/_utils'
import crypto from 'crypto'
import Twilio from 'twilio'
import type { ProfessionType } from '@prisma/client'

export const dynamic = 'force-dynamic'

console.log(
  '[register] DATABASE_URL host =',
  (() => {
    const u = process.env.DATABASE_URL
    if (!u) return '(missing)'
    try {
      return new URL(u).host
    } catch {
      return '(invalid url)'
    }
  })(),
)

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

  // ✅ PRO optional
  businessName?: unknown

  // ✅ PRO: required (per your flow)
  professionType?: unknown

  // ✅ handle optional (null until upgrade)
  handle?: unknown

  // ✅ Mobile: API/UI uses miles; DB stores km (schema: mobileRadiusKm)
  mobileRadiusMiles?: unknown

  // ✅ License inputs (required only for CA BBC professions)
  licenseState?: unknown
  licenseNumber?: unknown
}

/* =========================================================
   Helpers
========================================================= */

function envOrThrow(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
}

function envOrNull(name: string) {
  const v = process.env[name]
  return v && v.trim() ? v : null
}

function pickUpper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function cleanPhone(v: unknown): string | null {
  const raw = pickString(v)
  if (!raw) return null
  const cleaned = raw.replace(/[^\d+]/g, '').trim()
  if (!cleaned) return null

  const digits = cleaned.replace(/[^\d]/g, '')
  if (digits.length < 10) return null

  // US-only assumption for now
  if (!cleaned.startsWith('+') && digits.length === 10) return `+1${digits}`
  if (!cleaned.startsWith('+') && digits.length === 11 && digits.startsWith('1')) return `+${digits}`

  return cleaned
}

function normalizeRole(v: unknown): 'CLIENT' | 'PRO' | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'CLIENT') return 'CLIENT'
  if (s === 'PRO') return 'PRO'
  return null
}

function isLocationPayload(v: any): v is SignupLocation {
  if (!v || typeof v !== 'object') return false

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
    return typeof v.postalCode === 'string' && typeof v.lat === 'number' && typeof v.lng === 'number' && typeof v.timeZoneId === 'string'
  }

  return false
}

function defaultWorkingHours() {
  return {
    mon: { enabled: true, start: '09:00', end: '17:00' },
    tue: { enabled: true, start: '09:00', end: '17:00' },
    wed: { enabled: true, start: '09:00', end: '17:00' },
    thu: { enabled: true, start: '09:00', end: '17:00' },
    fri: { enabled: true, start: '09:00', end: '17:00' },
    sat: { enabled: false, start: '09:00', end: '17:00' },
    sun: { enabled: false, start: '09:00', end: '17:00' },
  }
}

function sha256(input: string) {
  return crypto.createHash('sha256').update(input).digest('hex')
}

function generateSmsCode() {
  const n = crypto.randomInt(0, 1_000_000)
  return String(n).padStart(6, '0')
}

function parseMaybeDate(v: string | null): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d : null
}

function normalizeLicenseNumber(v: unknown) {
  const raw = typeof v === 'string' ? v : ''
  return raw.trim().toUpperCase().replace(/\s+/g, '')
}

function normalizeHandleInput(raw: string) {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '')
    .slice(0, 24)
}

/**
 * UI uses miles. DB stores km (schema uses mobileRadiusKm).
 * Convert miles -> km, rounded to nearest int.
 */
function milesToKmInt(miles: number) {
  return Math.round(miles * 1.609344)
}

/**
 * Sends the verification SMS through Twilio.
 * - Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER
 */
async function sendPhoneVerificationSms(args: { to: string; code: string }) {
  const accountSid = envOrThrow('TWILIO_ACCOUNT_SID')
  const authToken = envOrThrow('TWILIO_AUTH_TOKEN')
  const from = envOrThrow('TWILIO_FROM_NUMBER')

  const client = Twilio(accountSid, authToken)
  const body = `TOVIS verification code: ${args.code}. Expires in 10 minutes.`

  const msg = await client.messages.create({
    to: args.to,
    from,
    body,
  })

  if (process.env.NODE_ENV !== 'production') {
    console.log('[phone-verification] twilio sent', { sid: msg.sid, to: args.to, from })
  } else {
    console.log('[phone-verification] twilio sent', { sid: msg.sid, to: args.to })
  }
}

function isPrismaUniqueError(err: any) {
  return err?.code === 'P2002' || String(err?.message || '').toLowerCase().includes('unique constraint')
}

/* =========================================================
   Profession rules
========================================================= */

// Full dropdown set (matches your Prisma enum)
const ALL_PROFESSIONS: ProfessionType[] = [
  'COSMETOLOGIST',
  'BARBER',
  'ESTHETICIAN',
  'MANICURIST',
  'HAIRSTYLIST',
  'ELECTROLOGIST',
  'MASSAGE_THERAPIST',
  'MAKEUP_ARTIST',
]

function isAnyProfessionType(v: string): v is ProfessionType {
  return (ALL_PROFESSIONS as string[]).includes(v)
}

// CA Board of Barbering & Cosmetology professions that require DCA/BreEZe license verification
const CA_BBC_LICENSE_REQUIRED: ProfessionType[] = [
  'COSMETOLOGIST',
  'BARBER',
  'ESTHETICIAN',
  'MANICURIST',
  'HAIRSTYLIST',
  'ELECTROLOGIST',
]

function requiresCaBbcLicense(p: ProfessionType) {
  return (CA_BBC_LICENSE_REQUIRED as string[]).includes(p)
}

/* =========================================================
   CA DCA (BreEZe) verification
========================================================= */

type CaVerifyResult =
  | {
      ok: true
      verified: true
      statusCode: string | null
      expDate: string | null
      raw: any
      source: 'CA_DCA_BREEZE'
    }
  | {
      ok: true
      verified: false
      statusCode: string | null
      expDate: string | null
      raw: any
      source: 'CA_DCA_BREEZE'
    }
  | { ok: false; error: string }

let cachedTypeMap: Record<string, string> | null = null
let cachedTypeExp = 0

async function getCaDcaTypeMap(): Promise<Record<string, string>> {
  const now = Date.now()
  if (cachedTypeMap && now < cachedTypeExp) return cachedTypeMap

  const APP_ID = envOrNull('DCA_SEARCH_APP_ID')
  const APP_KEY = envOrNull('DCA_SEARCH_APP_KEY')
  if (!APP_ID || !APP_KEY) {
    throw new Error('DCA API is not configured (missing DCA_SEARCH_APP_ID / DCA_SEARCH_APP_KEY).')
  }

  const url = 'https://iservices.dca.ca.gov/api/search/v1/breezeDetailService/getAllLicenseTypes'
  const res = await fetch(url, { headers: { APP_ID, APP_KEY }, cache: 'no-store' })
  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    throw new Error(data?.message || data?.error || 'DCA license types lookup failed.')
  }

  const rows = Array.isArray(data?.getAllLicenseTypes) ? data.getAllLicenseTypes : []
  const allTypes: any[] = rows.flatMap((r: any) => (Array.isArray(r?.licenseTypes) ? r.licenseTypes : []))

  const pick = (needle: string) => {
    const hit = allTypes.find((t) => {
      const long = String(t?.licenseLongName ?? '').toUpperCase()
      const pub = String(t?.publicNameDesc ?? '').toUpperCase()
      return long.includes(needle) || pub.includes(needle)
    })
    return hit?.clientCode ? String(hit.clientCode) : null
  }

  const map: Record<string, string> = {
    COSMETOLOGIST: pick('COSMETOLOG') ?? '',
    BARBER: pick('BARBER') ?? '',
    ESTHETICIAN: pick('ESTHETIC') ?? '',
    MANICURIST: pick('MANICUR') ?? '',
    HAIRSTYLIST: pick('HAIRSTYL') ?? '',
    ELECTROLOGIST: pick('ELECTRO') ?? '',
  }

  const missing = Object.entries(map)
    .filter(([, v]) => !v)
    .map(([k]) => k)

  if (missing.length) {
    throw new Error(`Could not resolve DCA licType codes for: ${missing.join(', ')}.`)
  }

  cachedTypeMap = map
  cachedTypeExp = now + 6 * 60 * 60 * 1000 // 6 hours
  return map
}

async function verifyCaBbcLicense(args: { professionType: ProfessionType; licenseNumber: string }): Promise<CaVerifyResult> {
  try {
    const APP_ID = envOrNull('DCA_SEARCH_APP_ID')
    const APP_KEY = envOrNull('DCA_SEARCH_APP_KEY')
    if (!APP_ID || !APP_KEY) {
      return { ok: false, error: 'License verification is not configured.' }
    }

    const typeMap = await getCaDcaTypeMap()
    const licType = typeMap[args.professionType]
    if (!licType) return { ok: false, error: 'Unsupported CA license type.' }

    const url = new URL('https://iservices.dca.ca.gov/api/search/v1/licenseSearchService/getLicenseNumberSearch')
    url.searchParams.set('licType', licType)
    url.searchParams.set('licNumber', args.licenseNumber)

    const res = await fetch(url.toString(), { headers: { APP_ID, APP_KEY }, cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) return { ok: false, error: data?.message || data?.error || 'License lookup failed.' }

    const detailsRoot = Array.isArray(data?.licenseDetails) ? data.licenseDetails : []
    const full = detailsRoot?.[0]?.getFullLicenseDetail?.[0] ?? null
    const lic = full?.getLicenseDetails?.[0] ?? null

    const statusCode = lic?.primaryStatusCode ? String(lic.primaryStatusCode) : null
    const expDate = lic?.expDate ? String(lic.expDate) : null
    const returnedNumber = lic?.licNumber ? String(lic.licNumber).toUpperCase() : null

    const numberMatches = returnedNumber && returnedNumber === args.licenseNumber
    const isCurrent = statusCode ? statusCode.toUpperCase().includes('CURRENT') : false

    return {
      ok: true,
      verified: Boolean(numberMatches && isCurrent),
      statusCode,
      expDate,
      raw: data,
      source: 'CA_DCA_BREEZE',
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || 'Verification error.' }
  }
}

/* =========================================================
   Route
========================================================= */

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as RegisterBody

    const email = normalizeEmail(body.email)
    const password = pickString(body.password)
    const role = normalizeRole(body.role)

    const firstName = pickString(body.firstName)
    const lastName = pickString(body.lastName)

    // ✅ required for ALL users
    const phone = cleanPhone(body.phone)

    const tapIntentId = pickString(body.tapIntentId)
    const signupLocation = isLocationPayload(body.signupLocation) ? (body.signupLocation as SignupLocation) : null

    if (!email || !password || !role) {
      return jsonFail(400, 'Missing required fields.', { code: 'MISSING_FIELDS' })
    }

    if (!firstName || !lastName) {
      return jsonFail(400, 'First and last name are required.', { code: 'MISSING_NAME' })
    }

    if (!phone) {
      return jsonFail(400, 'Phone number is required.', { code: 'PHONE_REQUIRED' })
    }

    // 🔒 Location enforcement
    if (role === 'PRO') {
      if (!signupLocation || (signupLocation.kind !== 'PRO_SALON' && signupLocation.kind !== 'PRO_MOBILE')) {
        return jsonFail(400, 'Please confirm your work location.', { code: 'PRO_LOCATION_REQUIRED' })
      }
    } else {
      if (!signupLocation || signupLocation.kind !== 'CLIENT_ZIP') {
        return jsonFail(400, 'Please confirm your ZIP code.', { code: 'CLIENT_ZIP_REQUIRED' })
      }
    }

    const finalTimeZone = isValidIanaTimeZone(signupLocation.timeZoneId) ? signupLocation.timeZoneId : null
    if (!finalTimeZone) {
      return jsonFail(400, 'Unable to determine a valid time zone.', { code: 'TIMEZONE_REQUIRED' })
    }

    // ✅ PRO: required profession
    const professionRaw = pickUpper(body.professionType)
    let profession: ProfessionType | null = null
    if (role === 'PRO') {
      if (!professionRaw) return jsonFail(400, 'Profession is required for pros.', { code: 'PROFESSION_REQUIRED' })
      if (!isAnyProfessionType(professionRaw)) return jsonFail(400, 'Invalid profession type.', { code: 'PROFESSION_INVALID' })
      profession = professionRaw as ProfessionType
    }

    // ✅ PRO: business name optional
    const businessNameRaw = pickString(body.businessName)
    const businessName = role === 'PRO' ? (businessNameRaw?.trim() ? businessNameRaw.trim() : null) : null

    // ✅ PRO: handle optional (null until upgrade)
    const handleRaw = pickString(body.handle)
    let handleToStore: string | null = null
    let normalizedHandle: string | null = null
    if (role === 'PRO' && handleRaw?.trim()) {
      handleToStore = handleRaw.trim()
      normalizedHandle = normalizeHandleInput(handleToStore)
      if (!normalizedHandle) {
        return jsonFail(400, 'Handle is invalid.', { code: 'HANDLE_INVALID' })
      }
    }

    // ✅ PRO: mobile radius only required if PRO_MOBILE (API uses miles)
    let mobileRadiusKm: number | null = null
    if (role === 'PRO' && signupLocation.kind === 'PRO_MOBILE') {
      const milesRaw = pickString(body.mobileRadiusMiles)
      const miles = milesRaw ? Number(milesRaw) : NaN
      if (!Number.isFinite(miles)) {
        return jsonFail(400, 'Mobile radius (miles) is required for mobile pros.', { code: 'MOBILE_RADIUS_REQUIRED' })
      }
      if (miles < 1 || miles > 200) {
        return jsonFail(400, 'Please enter a mobile radius between 1 and 200 miles.', { code: 'MOBILE_RADIUS_RANGE' })
      }
      mobileRadiusKm = milesToKmInt(miles)
    }

    // ✅ License verification (CA-only for now)
    // Only required for CA BBC professions. Makeup artists (and others) remain PENDING.
    let verificationStatus: 'PENDING' | 'APPROVED' = 'PENDING'
    let licenseVerified = false
    let licenseStateToStore: string | null = null
    let licenseNumberToStore: string | null = null
    let licenseExpiryToStore: Date | null = null
    let licenseVerifiedAtToStore: Date | null = null
    let licenseVerifiedSourceToStore: string | null = null
    let licenseStatusCodeToStore: string | null = null
    let licenseRawJsonToStore: any = null

    if (role === 'PRO' && profession) {
      if (requiresCaBbcLicense(profession)) {
        const licenseState = pickUpper(body.licenseState)
        const licenseNumber = normalizeLicenseNumber(body.licenseNumber)

        if (!licenseState || !licenseNumber) {
          return jsonFail(400, 'CA license state and number are required for this profession.', { code: 'LICENSE_REQUIRED' })
        }

        if (licenseState !== 'CA') {
          return jsonFail(400, 'Only California licenses are supported right now.', { code: 'LICENSE_STATE_UNSUPPORTED' })
        }

        const v = await verifyCaBbcLicense({ professionType: profession, licenseNumber })
        if (!v.ok) return jsonFail(500, v.error, { code: 'LICENSE_VERIFY_ERROR' })

        if (!v.verified) {
          return jsonFail(400, 'License could not be verified as CURRENT.', {
            code: 'LICENSE_NOT_VERIFIED',
            statusCode: v.statusCode ?? null,
          })
        }

        verificationStatus = 'APPROVED'
        licenseVerified = true
        licenseStateToStore = 'CA'
        licenseNumberToStore = licenseNumber
        licenseExpiryToStore = parseMaybeDate(v.expDate ?? null)
        licenseVerifiedAtToStore = new Date()
        licenseVerifiedSourceToStore = v.source
        licenseStatusCodeToStore = v.statusCode ?? null
        licenseRawJsonToStore = v.raw ?? null
      } else {
        // Makeup artists (and other non-CA-BBC) = no DCA check here
        verificationStatus = 'PENDING'
        licenseVerified = false
      }
    }

    // ✅ Enforce unique email + phone (fast pre-check)
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
      select: { email: true, phone: true },
    })

    if (existing?.email === email) return jsonFail(400, 'Email already in use.', { code: 'EMAIL_IN_USE' })
    if (existing?.phone === phone) return jsonFail(400, 'Phone number already in use.', { code: 'PHONE_IN_USE' })

    // ✅ Handle uniqueness only if user provided one
    if (role === 'PRO' && normalizedHandle) {
      const handleTaken = await prisma.professionalProfile.findFirst({
        where: { handleNormalized: normalizedHandle },
        select: { id: true },
      })
      if (handleTaken) return jsonFail(400, 'That handle is already taken.', { code: 'HANDLE_IN_USE' })
    }

    const passwordHash = await hashPassword(password)

    const { user, code } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          phone,
          phoneVerifiedAt: null,
          password: passwordHash,
          role,

          clientProfile:
            role === 'CLIENT'
              ? {
                  create: {
                    firstName,
                    lastName,
                    phone,
                    phoneVerifiedAt: null,
                  },
                }
              : undefined,

          professionalProfile:
            role === 'PRO'
              ? {
                  create: {
                    firstName,
                    lastName,
                    phone,
                    phoneVerifiedAt: null,

                    // fallback timezone (booking math should prefer location.timeZone)
                    timeZone: finalTimeZone,

                    bio: '',
                    location: '',

                    // ✅ optional
                    businessName,

                    // ✅ optional (null until upgrade)
                    handle: handleToStore,
                    handleNormalized: normalizedHandle,

                    // ✅ required for PRO
                    professionType: profession,

                    // ✅ license fields populated only for CA BBC verified professions
                    licenseNumber: licenseNumberToStore,
                    licenseState: licenseStateToStore,
                    licenseExpiry: licenseExpiryToStore,
                    licenseVerified,
                    verificationStatus,

                    // ✅ metadata fields you said you added
                    licenseVerifiedAt: licenseVerifiedAtToStore,
                    licenseVerifiedSource: licenseVerifiedSourceToStore,
                    licenseStatusCode: licenseStatusCodeToStore,
                    licenseRawJson: licenseRawJsonToStore,

                    // mobile travel settings
                    mobileBasePostalCode: signupLocation.kind === 'PRO_MOBILE' ? signupLocation.postalCode : null,
                    mobileRadiusKm: signupLocation.kind === 'PRO_MOBILE' ? mobileRadiusKm : null,

                    locations: {
                      create:
                        signupLocation.kind === 'PRO_SALON'
                          ? {
                              // ✅ per your request: store as SALON even if it's a suite
                              type: 'SALON',
                              name: signupLocation.name ?? null,
                              isPrimary: true,
                              isBookable: true,

                              formattedAddress: signupLocation.formattedAddress,
                              city: signupLocation.city,
                              state: signupLocation.state,
                              postalCode: signupLocation.postalCode,
                              countryCode: signupLocation.countryCode,
                              placeId: signupLocation.placeId,

                              lat: signupLocation.lat,
                              lng: signupLocation.lng,

                              timeZone: finalTimeZone,
                              workingHours: defaultWorkingHours(),
                            }
                          : {
                              type: 'MOBILE_BASE',
                              name: 'Mobile base',
                              isPrimary: true,
                              isBookable: true,

                              city: signupLocation.city,
                              state: signupLocation.state,
                              postalCode: signupLocation.postalCode,
                              countryCode: signupLocation.countryCode,

                              lat: signupLocation.lat,
                              lng: signupLocation.lng,

                              timeZone: finalTimeZone,
                              workingHours: defaultWorkingHours(),
                            },
                    },
                  },
                }
              : undefined,
        },
        select: { id: true, email: true, role: true, phone: true },
      })

      // invalidate old unused codes
      await tx.phoneVerification.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      })

      const code = generateSmsCode()
      const codeHash = sha256(code)
      const expiresAt = new Date(Date.now() + 1000 * 60 * 10) // 10 min

      await tx.phoneVerification.create({
        data: { userId: user.id, phone, codeHash, expiresAt },
        select: { id: true },
      })

      return { user, code }
    })

    // ✅ Send SMS AFTER tx success
    try {
      await sendPhoneVerificationSms({ to: user.phone!, code })
    } catch (smsErr) {
      console.error('[phone-verification] failed to send', smsErr)
    }

    const consumed = await consumeTapIntent({ tapIntentId, userId: user.id }).catch(() => null)
    const token = createToken({ userId: user.id, role: user.role })

    const res = jsonOk(
      {
        user: { id: user.id, email: user.email, role: user.role },
        nextUrl: consumed?.nextUrl ?? null,
        requiresPhoneVerification: true,
      },
      201,
    )

    res.cookies.set('tovis_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    })

    if (signupLocation.kind === 'CLIENT_ZIP') {
      res.cookies.set('tovis_client_zip', signupLocation.postalCode, {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 90,
      })
    }

    return res
  } catch (err: any) {
    if (isPrismaUniqueError(err)) {
      return jsonFail(400, 'Email or phone already in use.', { code: 'DUPLICATE_ACCOUNT' })
    }

    const msg = String(err?.message || '')
    if (msg.includes('Missing env var: TWILIO_')) {
      console.error('[phone-verification] twilio env missing', err)
      return jsonFail(500, 'SMS provider is not configured.', { code: 'SMS_NOT_CONFIGURED' })
    }

    if (msg.includes('DCA API is not configured') || msg.includes('Could not resolve DCA licType codes')) {
      console.error('[license-verification] dca config error', err)
      return jsonFail(500, 'License verification is not configured.', { code: 'LICENSE_VERIFY_CONFIG' })
    }

    console.error('Register error', err)
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}
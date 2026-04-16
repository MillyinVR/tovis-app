// app/api/auth/register/route.ts
import { prisma } from '@/lib/prisma'
import { hashPassword, createVerificationToken } from '@/lib/auth'
import { validatePassword } from '@/lib/passwordPolicy'
import { getCurrentTosVersion } from '@/lib/legal'
import { verifyTurnstileOrFailOpen } from '@/lib/auth/turnstile'
import { consumeTapIntent } from '@/lib/tapIntentConsume'
import {
  getAppUrlFromRequest,
  issueAndSendEmailVerification,
} from '@/lib/auth/emailVerification'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { BUCKETS } from '@/lib/storageBuckets'
import {
  jsonFail,
  jsonOk,
  pickString,
  normalizeEmail,
  enforceRateLimit,
  rateLimitIdentity,
  phoneRateLimitIdentity,
} from '@/app/api/_utils'
import crypto from 'crypto'
import Twilio from 'twilio'
import {
  Prisma,
  type ProfessionType,
  VerificationDocumentType,
  VerificationStatus,
} from '@prisma/client'
import { isRuntimeFlagEnabled } from '@/lib/runtimeFlags'
import { validateSmsDestinationCountry } from '@/lib/smsCountryPolicy'
import {
  logAuthEvent,
  captureAuthException,
} from '@/lib/observability/authEvents'

export const dynamic = 'force-dynamic'

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

type SmsSendResult =
  | { ok: true }
  | {
      ok: false
      code: 'SMS_NOT_CONFIGURED' | 'SMS_SEND_FAILED'
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

  // pro fields
  businessName?: unknown
  professionType?: unknown
  handle?: unknown
  mobileRadiusMiles?: unknown

  // license fields
  licenseState?: unknown
  licenseNumber?: unknown

  // ✅ optional at signup now
  licenseDocumentUrl?: unknown

  // step 2 hardening
  tosAccepted?: unknown
  turnstileToken?: unknown
}

/* =========================================================
   Helpers
========================================================= */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function envOrNull(name: string) {
  const v = process.env[name]
  return v && v.trim() ? v : null
}

function pickUpper(v: unknown) {
  return typeof v === 'string' ? v.trim().toUpperCase() : ''
}

function sanitizeInternalPath(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()
  if (!value) return null
  if (!value.startsWith('/')) return null
  if (value.startsWith('//')) return null
  return value
}

function sanitizeOptionalText(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim()
  return value || null
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
  if (
    !cleaned.startsWith('+') &&
    digits.length === 11 &&
    digits.startsWith('1')
  ) {
    return `+${digits}`
  }

  return cleaned
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
  return raw.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 24)
}

/** Accept number or string, return finite number or null */
function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = pickString(v)
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
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

function validateLicenseDocUrl(
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

function createManualLicenseDocData(urlOrRef: string) {
  return {
    type: VerificationDocumentType.LICENSE,
    label: 'License (manual review)',
    url: urlOrRef,
    status: VerificationStatus.PENDING,
  }
}

async function sendPhoneVerificationSms(args: {
  to: string
  code: string
}): Promise<SmsSendResult> {
  const accountSid = envOrNull('TWILIO_ACCOUNT_SID')
  const authToken = envOrNull('TWILIO_AUTH_TOKEN')
  const from = envOrNull('TWILIO_FROM_NUMBER')

  if (!accountSid || !authToken || !from) {
    logAuthEvent({
      level: 'error',
      event: 'auth.phone.send.not_configured',
      route: 'auth.register',
      provider: 'twilio',
      code: 'SMS_NOT_CONFIGURED',
      phone: args.to,
    })
    return { ok: false, code: 'SMS_NOT_CONFIGURED' }
  }

  try {
    const client = Twilio(accountSid, authToken)
    const body = `TOVIS verification code: ${args.code}. Expires in 10 minutes.`
    const msg = await client.messages.create({ to: args.to, from, body })

    logAuthEvent({
      level: 'info',
      event: 'auth.phone.send.success',
      route: 'auth.register',
      provider: 'twilio',
      phone: args.to,
      meta: {
        sid: msg.sid,
      },
    })

    return { ok: true }
  } catch (err) {
    captureAuthException({
      event: 'auth.phone.send.failed',
      route: 'auth.register',
      provider: 'twilio',
      code: 'SMS_SEND_FAILED',
      phone: args.to,
      error: err,
    })
    return { ok: false, code: 'SMS_SEND_FAILED' }
  }
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

function hostToHostname(hostHeader: string | null): string | null {
  if (!hostHeader) return null

  // In some proxy setups headers can be a comma-separated list; take first
  const first = hostHeader.split(',')[0]?.trim().toLowerCase() ?? ''
  if (!first) return null

  // Handle IPv6 like "[::1]:3000"
  if (first.startsWith('[')) {
    const end = first.indexOf(']')
    if (end === -1) return null
    return first.slice(1, end)
  }

  // Strip port if present: "localhost:3000" -> "localhost"
  const idx = first.indexOf(':')
  return idx >= 0 ? first.slice(0, idx) : first
}

function resolveCookieDomain(hostname: string | null): string | undefined {
  if (!hostname) return undefined

  if (hostname === 'tovis.app' || hostname.endsWith('.tovis.app')) {
    return '.tovis.app'
  }
  if (hostname === 'tovis.me' || hostname.endsWith('.tovis.me')) {
    return '.tovis.me'
  }

  // localhost / unknown hosts: host-only cookie (no Domain attribute)
  return undefined
}

function resolveIsHttps(request: Request): boolean {
  // Prefer proxy headers (Vercel / reverse proxies)
  const xfProto = request.headers
    .get('x-forwarded-proto')
    ?.trim()
    .toLowerCase()
  if (xfProto === 'https') return true
  if (xfProto === 'http') return false

  // Fallback to request.url
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

function getRequestHostname(request: Request): string | null {
  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host')
  return hostToHostname(host)
}

/* =========================================================
   Profession rules
========================================================= */

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
  return (ALL_PROFESSIONS as readonly string[]).includes(v)
}

const CA_BBC_LICENSE_REQUIRED: ProfessionType[] = [
  'COSMETOLOGIST',
  'BARBER',
  'ESTHETICIAN',
  'MANICURIST',
  'HAIRSTYLIST',
  'ELECTROLOGIST',
]

function requiresCaBbcLicense(p: ProfessionType) {
  return (CA_BBC_LICENSE_REQUIRED as readonly string[]).includes(p)
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
      raw: Prisma.InputJsonValue
      source: 'CA_DCA_BREEZE'
    }
  | {
      ok: true
      verified: false
      statusCode: string | null
      expDate: string | null
      raw: Prisma.InputJsonValue
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
    throw new Error(
      'DCA API is not configured (missing DCA_SEARCH_APP_ID / DCA_SEARCH_APP_KEY).',
    )
  }

  const url =
    'https://iservices.dca.ca.gov/api/search/v1/breezeDetailService/getAllLicenseTypes'
  const res = await fetch(url, {
    headers: { APP_ID, APP_KEY },
    cache: 'no-store',
  })
  const data: unknown = await res.json().catch(() => ({}))

  if (!res.ok) {
    const msg =
      isRecord(data) &&
      (typeof data.message === 'string' || typeof data.error === 'string')
        ? String(data.message ?? data.error)
        : 'DCA license types lookup failed.'
    throw new Error(msg)
  }

  const rows = isRecord(data) ? asArray(data.getAllLicenseTypes) : []
  const allTypes: unknown[] = rows.flatMap((r) => {
    if (!isRecord(r)) return []
    return asArray(r.licenseTypes)
  })

  const pick = (needle: string) => {
    const need = needle.toUpperCase()
    const hit = allTypes.find((t) => {
      if (!isRecord(t)) return false
      const long = String(t.licenseLongName ?? '').toUpperCase()
      const pub = String(t.publicNameDesc ?? '').toUpperCase()
      return long.includes(need) || pub.includes(need)
    })
    if (!hit || !isRecord(hit)) return null
    const code = hit.clientCode
    return typeof code === 'string' && code.trim() ? code.trim() : null
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
    throw new Error(
      `Could not resolve DCA licType codes for: ${missing.join(', ')}.`,
    )
  }

  cachedTypeMap = map
  cachedTypeExp = now + 6 * 60 * 60 * 1000 // 6 hours
  return map
}

async function verifyCaBbcLicense(args: {
  professionType: ProfessionType
  licenseNumber: string
}): Promise<CaVerifyResult> {
  try {
    const APP_ID = envOrNull('DCA_SEARCH_APP_ID')
    const APP_KEY = envOrNull('DCA_SEARCH_APP_KEY')
    if (!APP_ID || !APP_KEY) {
      return { ok: false, error: 'License verification is not configured.' }
    }

    const typeMap = await getCaDcaTypeMap()
    const licType = typeMap[args.professionType]
    if (!licType) return { ok: false, error: 'Unsupported CA license type.' }

    const url = new URL(
      'https://iservices.dca.ca.gov/api/search/v1/licenseSearchService/getLicenseNumberSearch',
    )
    url.searchParams.set('licType', licType)
    url.searchParams.set('licNumber', args.licenseNumber)

    const res = await fetch(url.toString(), {
      headers: { APP_ID, APP_KEY },
      cache: 'no-store',
    })
    const data: unknown = await res.json().catch(() => ({}))

    if (!res.ok) {
      const msg =
        isRecord(data) &&
        (typeof data.message === 'string' || typeof data.error === 'string')
          ? String(data.message ?? data.error)
          : 'License lookup failed.'
      return { ok: false, error: msg }
    }

    const detailsRoot = isRecord(data) ? asArray(data.licenseDetails) : []
    const first = detailsRoot.length ? detailsRoot[0] : null
    const full = isRecord(first) ? asArray(first.getFullLicenseDetail)[0] : null
    const lic = isRecord(full) ? asArray(full.getLicenseDetails)[0] : null

    const statusCode =
      isRecord(lic) && lic.primaryStatusCode != null
        ? String(lic.primaryStatusCode)
        : null
    const expDate =
      isRecord(lic) && lic.expDate != null ? String(lic.expDate) : null
    const returnedNumber =
      isRecord(lic) && lic.licNumber != null
        ? String(lic.licNumber).toUpperCase()
        : null

    const numberMatches = Boolean(
      returnedNumber && returnedNumber === args.licenseNumber,
    )
    const isCurrent = statusCode
      ? statusCode.toUpperCase().includes('CURRENT')
      : false

    // Prisma wants InputJsonValue for create/update inputs.
    // fetch().json() is JSON-safe; stringify/parse guarantees no Date/functions/undefined.
    const rawJson: Prisma.InputJsonValue = JSON.parse(
      JSON.stringify(data ?? {}),
    )

    return {
      ok: true,
      verified: Boolean(numberMatches && isCurrent),
      statusCode,
      expDate,
      raw: rawJson,
      source: 'CA_DCA_BREEZE',
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Verification error.'
    return { ok: false, error: msg }
  }
}

/* =========================================================
   Route
========================================================= */

export async function POST(request: Request) {
  let emailForLog: string | null = null
  let phoneForLog: string | null = null

  try {
    const body = (await request.json().catch(() => ({}))) as RegisterBody

    const email = normalizeEmail(body.email)
    const password = pickString(body.password)
    const role = normalizeRole(body.role)

    const firstName = pickString(body.firstName)
    const lastName = pickString(body.lastName)

    const rawPhone = pickString(body.phone)
    const phone = rawPhone ? cleanPhone(rawPhone) : null

    emailForLog = email
    phoneForLog = phone

    const tosAccepted = body.tosAccepted === true
    const turnstileToken = pickString(body.turnstileToken)

    const tapIntentId = pickString(body.tapIntentId)
    const signupLocation = isLocationPayload(body.signupLocation)
      ? body.signupLocation
      : null
    const nextForVerification = sanitizeInternalPath(pickString(body.next))
    const verificationIntent = sanitizeOptionalText(pickString(body.intent))
    const verificationInviteToken = sanitizeOptionalText(
      pickString(body.inviteToken),
    )

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

    let tosVersion: string
    try {
      tosVersion = getCurrentTosVersion()
    } catch {
      return jsonFail(500, 'Terms version is not configured.', {
        code: 'TOS_VERSION_MISSING',
      })
    }

    const captcha = await verifyTurnstileOrFailOpen({
      request,
      token: turnstileToken,
    })

    if (!captcha.ok) {
      return jsonFail(400, captcha.message, { code: captcha.code })
    }

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

    const identity = await rateLimitIdentity()

    const registerBucket = captcha.failOpen
      ? 'auth:register'
      : 'auth:register:verified'

    const registerRateLimitRes = await enforceRateLimit({
      bucket: registerBucket,
      identity,
    })

    if (registerRateLimitRes) return registerRateLimitRes

    // pro profession
    const professionRaw = pickUpper(body.professionType)
    let profession: ProfessionType | null = null
    if (role === 'PRO') {
      if (!professionRaw) {
        return jsonFail(400, 'Profession is required for pros.', {
          code: 'PROFESSION_REQUIRED',
        })
      }
      if (!isAnyProfessionType(professionRaw)) {
        return jsonFail(400, 'Invalid profession type.', {
          code: 'PROFESSION_INVALID',
        })
      }
      profession = professionRaw
    }

    // business name
    const businessNameRaw = pickString(body.businessName)
    const businessName =
      role === 'PRO'
        ? businessNameRaw?.trim()
          ? businessNameRaw.trim()
          : null
        : null

    // handle
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

    // mobile radius
    let mobileRadiusMiles: number | null = null
    if (role === 'PRO' && signupLocation.kind === 'PRO_MOBILE') {
      const miles = parseNumber(body.mobileRadiusMiles)
      if (miles == null) {
        return jsonFail(
          400,
          'Mobile radius (miles) is required for mobile pros.',
          { code: 'MOBILE_RADIUS_REQUIRED' },
        )
      }
      if (miles < 1 || miles > 200) {
        return jsonFail(
          400,
          'Please enter a mobile radius between 1 and 200 miles.',
          { code: 'MOBILE_RADIUS_RANGE' },
        )
      }
      mobileRadiusMiles = Math.round(miles)
    }

    // license verification + manual follow-up (NEW FLOW)
    let verificationStatus: VerificationStatus = VerificationStatus.PENDING
    let licenseVerified = false
    let licenseStateToStore: string | null = null
    let licenseNumberToStore: string | null = null
    let licenseExpiryToStore: Date | null = null
    let licenseVerifiedAtToStore: Date | null = null
    let licenseVerifiedSourceToStore: string | null = null
    let licenseStatusCodeToStore: string | null = null

    // ✅ KEY FIX: never null, only set when we actually have a JSON payload
    let licenseRawJsonToStore: Prisma.InputJsonValue | undefined = undefined

    let manualLicenseDocUrl: string | null = null
    let needsManualLicenseUpload = false
    let manualLicensePendingReview = false

    if (role === 'PRO' && profession && requiresCaBbcLicense(profession)) {
      const licenseState = pickUpper(body.licenseState)
      const licenseNumber = normalizeLicenseNumber(body.licenseNumber)

      if (!licenseState || !licenseNumber) {
        return jsonFail(
          400,
          'CA license state and number are required for this profession.',
          { code: 'LICENSE_REQUIRED' },
        )
      }
      if (licenseState !== 'CA') {
        return jsonFail(
          400,
          'Only California licenses are supported right now.',
          { code: 'LICENSE_STATE_UNSUPPORTED' },
        )
      }

      licenseStateToStore = 'CA'
      licenseNumberToStore = licenseNumber

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
        return jsonFail(400, 'License could not be verified as CURRENT.', {
          code: 'LICENSE_NOT_VERIFIED',
          statusCode: v.statusCode ?? null,
        })
      } else {
        // ✅ DCA unavailable -> allow signup; require post-signup upload.
        const docUrlRaw = pickString(body.licenseDocumentUrl)
        if (docUrlRaw?.trim()) {
          const checked = validateLicenseDocUrl(docUrlRaw)
          if (!checked.ok) {
            return jsonFail(400, checked.error, {
              code: 'LICENSE_DOC_INVALID',
            })
          }
          manualLicenseDocUrl = checked.value
          manualLicensePendingReview = true
        } else {
          needsManualLicenseUpload = true
        }

        verificationStatus = VerificationStatus.PENDING
        licenseVerified = false
        licenseRawJsonToStore = {
          note: 'DCA unavailable at signup; manual follow-up required',
          error: v.error ?? null,
          needsManualUpload: needsManualLicenseUpload,
          docProvidedAtSignup: Boolean(manualLicenseDocUrl),
        } satisfies Prisma.InputJsonValue
      }
    }

    // handle uniqueness
    if (role === 'PRO' && normalizedHandle) {
      const handleTaken = await prisma.professionalProfile.findFirst({
        where: { handleNormalized: normalizedHandle },
        select: { id: true },
      })
      if (handleTaken) {
        return jsonFail(400, 'That handle is already taken.', {
          code: 'HANDLE_IN_USE',
        })
      }
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

    const passwordHash = await hashPassword(password)

    const { user, code } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          phone,
          phoneVerifiedAt: null,
          emailVerifiedAt: null,
          password: passwordHash,
          role,
          tosAcceptedAt: new Date(),
          tosVersion,

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
                    timeZone: finalTimeZone,

                    bio: '',
                    location: '',

                    businessName,
                    handle: handleToStore,
                    handleNormalized: normalizedHandle,

                    professionType: profession,

                    licenseNumber: licenseNumberToStore,
                    licenseState: licenseStateToStore,
                    licenseExpiry: licenseExpiryToStore,
                    licenseVerified,
                    verificationStatus,

                    licenseVerifiedAt: licenseVerifiedAtToStore,
                    licenseVerifiedSource: licenseVerifiedSourceToStore,
                    licenseStatusCode: licenseStatusCodeToStore,

                    // ✅ IMPORTANT: omit when undefined (prevents exactOptionalPropertyTypes pain)
                    ...(licenseRawJsonToStore !== undefined
                      ? { licenseRawJson: licenseRawJsonToStore }
                      : {}),

                    mobileBasePostalCode:
                      signupLocation.kind === 'PRO_MOBILE'
                        ? signupLocation.postalCode
                        : null,
                    mobileRadiusMiles:
                      signupLocation.kind === 'PRO_MOBILE'
                        ? mobileRadiusMiles
                        : null,

                    locations: {
                      create:
                        signupLocation.kind === 'PRO_SALON'
                          ? {
                              type: 'SALON',
                              name: signupLocation.name ?? null,
                              isPrimary: true,
                              isBookable: true,

                              formattedAddress:
                                signupLocation.formattedAddress,
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

                    verificationDocs: manualLicenseDocUrl
                      ? {
                          create: createManualLicenseDocData(
                            manualLicenseDocUrl,
                          ),
                        }
                      : undefined,
                  },
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

      await tx.phoneVerification.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      })

      const code = generateSmsCode()
      const codeHash = sha256(code)
      const expiresAt = new Date(Date.now() + 1000 * 60 * 10)

      await tx.phoneVerification.create({
        data: { userId: user.id, phone, codeHash, expiresAt },
        select: { id: true },
      })

      return { user, code }
    })

    const smsResult = await sendPhoneVerificationSms({ to: user.phone!, code })
    const phoneVerificationSent = smsResult.ok
    const phoneVerificationErrorCode = smsResult.ok ? null : smsResult.code

    let emailVerificationSent = false

    const verificationEmail = normalizeEmail(user.email)

    if (verificationEmail) {
      try {
        await issueAndSendEmailVerification({
          userId: user.id,
          email: verificationEmail,
          appUrl,
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

        emailVerificationSent = true
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

    const consumed = await consumeTapIntent({
      tapIntentId,
      userId: user.id,
    }).catch(() => null)

    const token = createVerificationToken({
      userId: user.id,
      role: user.role,
      authVersion: user.authVersion,
    })

    const res = jsonOk(
      {
        user: { id: user.id, email: user.email, role: user.role },
        nextUrl: consumed?.nextUrl ?? nextForVerification ?? null,
        requiresPhoneVerification: true,
        phoneVerificationSent,
        phoneVerificationErrorCode,
        requiresEmailVerification: true,
        isPhoneVerified: false,
        isEmailVerified: false,
        isFullyVerified: false,
        emailVerificationSent,

        // ✅ safe flags for the client UX
        needsManualLicenseUpload:
          role === 'PRO' ? needsManualLicenseUpload : false,
        manualLicensePendingReview:
          role === 'PRO' ? manualLicensePendingReview : false,
      },
      201,
    )

    const hostname = getRequestHostname(request)
    const cookieDomain = resolveCookieDomain(hostname)
    const isHttps = resolveIsHttps(request)

    res.cookies.set('tovis_token', token, {
      httpOnly: true,
      secure: isHttps, // ✅ based on actual protocol, not NODE_ENV
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
      ...(cookieDomain ? { domain: cookieDomain } : {}),
    })

    if (signupLocation.kind === 'CLIENT_ZIP') {
      res.cookies.set('tovis_client_zip', signupLocation.postalCode, {
        httpOnly: false,
        secure: isHttps, // ✅ based on actual protocol, not NODE_ENV
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
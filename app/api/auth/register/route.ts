// app/api/auth/register/route.ts
import { prisma } from '@/lib/prisma'
import { hashPassword, createToken } from '@/lib/auth'
import { consumeTapIntent } from '@/lib/tapIntentConsume'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { jsonFail, jsonOk, pickString, normalizeEmail } from '@/app/api/_utils'
import crypto from 'crypto'
import Twilio from 'twilio'

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

type RegisterBody = {
  email?: unknown
  password?: unknown
  role?: unknown
  firstName?: unknown
  lastName?: unknown
  phone?: unknown
  tapIntentId?: unknown
  timeZone?: unknown
  signupLocation?: unknown
}

/* =========================================================
   Helpers
========================================================= */

function envOrThrow(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env var: ${name}`)
  return v
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

  // Don't log codes in production
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

    // ✅ Enforce unique email + phone (fast pre-check)
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
      select: { email: true, phone: true },
    })

    if (existing?.email === email) return jsonFail(400, 'Email already in use.', { code: 'EMAIL_IN_USE' })
    if (existing?.phone === phone) return jsonFail(400, 'Phone number already in use.', { code: 'PHONE_IN_USE' })

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
                    timeZone: finalTimeZone,

                    bio: '',
                    location: '',
                    professionType: null,

                    mobileBasePostalCode: signupLocation.kind === 'PRO_MOBILE' ? signupLocation.postalCode : null,

                    locations: {
                      create:
                        signupLocation.kind === 'PRO_SALON'
                          ? {
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
      // If SMS fails, we still created the account. That's okay.
      // We return a clear flag so the UI can offer "Resend code".
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

    // Missing Twilio env vars, etc.
    const msg = String(err?.message || '')
    if (msg.includes('Missing env var: TWILIO_')) {
      console.error('[phone-verification] twilio env missing', err)
      return jsonFail(500, 'SMS provider is not configured.', { code: 'SMS_NOT_CONFIGURED' })
    }

    console.error('Register error', err)
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}

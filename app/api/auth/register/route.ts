// app/api/auth/register/route.ts
import { prisma } from '@/lib/prisma'
import { hashPassword, createToken } from '@/lib/auth'
import { consumeTapIntent } from '@/lib/tapIntentConsume'
import { isValidIanaTimeZone } from '@/lib/timeZone'
import { jsonFail, jsonOk, pickString, normalizeEmail } from '@/app/api/_utils'

export const dynamic = 'force-dynamic'

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

  // ✅ new
  signupLocation?: unknown
}

function cleanPhone(v: unknown): string | null {
  const raw = pickString(v)
  if (!raw) return null
  const cleaned = raw.replace(/[^\d+]/g, '')
  return cleaned ? cleaned : null
}

function normalizeRole(v: unknown): 'CLIENT' | 'PRO' | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'CLIENT') return 'CLIENT'
  if (s === 'PRO') return 'PRO'
  return null
}

function normalizeTimeZone(v: unknown): string | null {
  const raw = pickString(v)
  if (!raw) return null
  const tz = raw.trim()
  return isValidIanaTimeZone(tz) ? tz : null
}

function isLocationPayload(v: any): v is SignupLocation {
  if (!v || typeof v !== 'object') return false
  const kind = String(v.kind || '')
  if (!kind) return false

  if (kind === 'PRO_SALON') {
    return (
      typeof v.placeId === 'string' &&
      typeof v.formattedAddress === 'string' &&
      typeof v.lat === 'number' &&
      typeof v.lng === 'number' &&
      typeof v.timeZoneId === 'string'
    )
  }

  if (kind === 'PRO_MOBILE' || kind === 'CLIENT_ZIP') {
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

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as RegisterBody

    const email = normalizeEmail(body.email)
    const password = pickString(body.password)
    const role = normalizeRole(body.role)

    const firstName = pickString(body.firstName)
    const lastName = pickString(body.lastName)
    const phone = cleanPhone(body.phone)
    const tapIntentId = pickString(body.tapIntentId)

    // ✅ accept only valid tz; do NOT default to UTC
    const timeZone = normalizeTimeZone(body.timeZone)

    const signupLocationRaw = body.signupLocation as any
    const signupLocation = isLocationPayload(signupLocationRaw) ? signupLocationRaw : null

    if (!email || !password || !role) {
      return jsonFail(400, 'Missing required fields.', { code: 'MISSING_FIELDS' })
    }

    if (!firstName || !lastName) {
      return jsonFail(400, 'First and last name are required.', { code: 'MISSING_NAME' })
    }

    if (role === 'PRO' && !phone) {
      return jsonFail(400, 'Phone number is required for professionals.', { code: 'PHONE_REQUIRED' })
    }

    // ✅ enforce location presence at signup
    if (role === 'PRO') {
      if (!signupLocation || (signupLocation.kind !== 'PRO_SALON' && signupLocation.kind !== 'PRO_MOBILE')) {
        return jsonFail(400, 'Please confirm your work location (Salon or Mobile).', { code: 'PRO_LOCATION_REQUIRED' })
      }
    } else {
      if (!signupLocation || signupLocation.kind !== 'CLIENT_ZIP') {
        return jsonFail(400, 'Please confirm your ZIP code.', { code: 'CLIENT_ZIP_REQUIRED' })
      }
    }

    // Extra safety: timezone must match location tz (if provided)
    const tzFromLocation = signupLocation?.timeZoneId ?? null
    const finalTz = tzFromLocation && isValidIanaTimeZone(tzFromLocation) ? tzFromLocation : timeZone

    if (!finalTz) {
      return jsonFail(400, 'Could not determine a valid time zone from your location.', { code: 'TIMEZONE_REQUIRED' })
    }

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } })
    if (existing) {
      return jsonFail(400, 'Email already in use.', { code: 'EMAIL_IN_USE' })
    }

    const passwordHash = await hashPassword(password)

    const user = await prisma.user.create({
      data: {
        email,
        password: passwordHash,
        role,

        clientProfile:
          role === 'CLIENT'
            ? { create: { firstName, lastName, phone: phone ?? null } }
            : undefined,

        professionalProfile:
          role === 'PRO'
            ? {
                create: {
                  firstName,
                  lastName,
                  phone: phone ?? null,
                  timeZone: finalTz,

                  bio: '',
                  location: '',
                  professionType: null,
                  licenseNumber: null,
                  licenseState: null,
                  licenseExpiry: null,

                  // for mobile pros (optional convenience)
                  mobileBasePostalCode: signupLocation.kind === 'PRO_MOBILE' ? signupLocation.postalCode : null,
                  mobileRadiusKm: null, // you said zip only for now
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

                            timeZone: finalTz,
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

                            timeZone: finalTz,
                            workingHours: defaultWorkingHours(),
                          },
                  },
                },
              }
            : undefined,
      },
      select: { id: true, email: true, role: true },
    })

    const token = createToken({ userId: user.id, role: user.role })

    const consumed = await consumeTapIntent({ tapIntentId, userId: user.id }).catch(() => null)

    const res = jsonOk(
      {
        user: { id: user.id, email: user.email, role: user.role },
        nextUrl: consumed?.nextUrl ?? null,
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

    // ✅ client ZIP convenience cookie (until you add it to ClientProfile)
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
  } catch (error) {
    console.error('Register error', error)
    return jsonFail(500, 'Internal server error', { code: 'INTERNAL' })
  }
}

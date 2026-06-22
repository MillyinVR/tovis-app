// app/(auth)/_components/signup/SignupProClient.tsx

'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import AuthShell from '../AuthShell'
import FieldLabel from '../FieldLabel'
import HelpText from '../HelpText'
import Input from '../Input'
import PasswordInput from '../PasswordInput'
import PrimaryButton from '../PrimaryButton'
import SecondaryLinkButton from '../SecondaryLinkButton'
import { cn } from '@/lib/utils'
import { isRecord } from '@/lib/guards'
import { sanitizeHandleInput } from '@/lib/handles'
import { safeJsonRecord, readErrorMessage, readStringField } from '@/lib/http'
import { hardNavigate } from '@/lib/clientNavigation'
import { friendlyTimeZoneLabel } from '@/lib/timeZone'
import { getTurnstileToken } from '@/lib/turnstileClient'
import { buildVerifyPhoneUrl } from './buildVerifyPhoneUrl'
import {
  buildLoginHref,
  readSignupForwardedParams,
  sanitizeNextUrl,
} from './signupSearchParams'
import {
  FieldErrorText,
  fieldErrorDescribedBy,
  focusFieldById,
} from './fieldErrors'
import { buildTransactionalSmsCheckboxLabel } from '@/lib/transactionalSmsPolicy'
import { useBrand } from '@/lib/brand/BrandProvider'
import { US_STATES, stateName } from '@/lib/usStates'
import {
  getLicenseRequirement,
  requiresLicense,
  supportsOnlineVerification,
} from '@/lib/licensing/licenseRequirement'
import { PASSWORD_MIN_LEN } from '@/lib/passwordPolicyConstants'
import {
  compactPhoneInputForSubmit,
  formatPhoneInputValue,
  isLikelyValidPhoneInput,
} from '@/lib/phoneInputFormat'

type VerificationSendState = boolean | 'pending'

type ProField =
  | 'location'
  | 'radius'
  | 'state'
  | 'licenseNumber'
  | 'firstName'
  | 'lastName'
  | 'phone'
  | 'smsConsent'
  | 'email'
  | 'password'
  | 'tos'

const FIELD_IDS: Record<ProField, string> = {
  location: 'signup-pro-location',
  radius: 'signup-pro-radius',
  state: 'signup-pro-state',
  licenseNumber: 'signup-pro-license-number',
  firstName: 'signup-first-name',
  lastName: 'signup-last-name',
  phone: 'signup-phone',
  smsConsent: 'signup-sms-consent',
  email: 'signup-email',
  password: 'signup-password',
  tos: 'signup-tos',
}

const FIELD_ORDER: ProField[] = [
  'location',
  'radius',
  'state',
  'licenseNumber',
  'firstName',
  'lastName',
  'phone',
  'smsConsent',
  'email',
  'password',
  'tos',
]

const STEP_LABELS = ['Your work', 'About you', 'Account'] as const

const LAST_STEP = STEP_LABELS.length - 1

const STEP_FIELDS: ProField[][] = [
  ['location', 'radius', 'state', 'licenseNumber'],
  ['firstName', 'lastName', 'phone', 'smsConsent'],
  ['email', 'password', 'tos'],
]

function stepOfField(field: ProField): number {
  const index = STEP_FIELDS.findIndex((fields) => fields.includes(field))
  return index === -1 ? 0 : index
}


function readVerificationSendState(
  data: Record<string, unknown> | null,
  key: string,
): VerificationSendState {
  const value = data?.[key]
  if (value === 'pending') return 'pending'
  return value === true
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        'w-full rounded-card border px-3 py-2 text-sm outline-none transition',
        'border-surfaceGlass/10 bg-bgSecondary/35 text-textPrimary',
        'hover:border-surfaceGlass/16',
        'focus:border-accentPrimary/35 focus:ring-2 focus:ring-accentPrimary/15',
        props.disabled && 'opacity-70',
        props.className ?? '',
      )}
    />
  )
}

function isUsZip(raw: string) {
  const s = raw.trim()
  return /^\d{5}(-\d{4})?$/.test(s)
}


type ProfessionType =
  | 'COSMETOLOGIST'
  | 'BARBER'
  | 'ESTHETICIAN'
  | 'MANICURIST'
  | 'HAIRSTYLIST'
  | 'ELECTROLOGIST'
  | 'MASSAGE_THERAPIST'
  | 'MAKEUP_ARTIST'
  | 'LASH_TECHNICIAN'
  | 'HAIR_BRAIDER'
  | 'PERMANENT_MAKEUP_ARTIST'

type GooglePrediction = {
  placeId: string
  description: string
  mainText: string
  secondaryText: string
}

type ConfirmedLocation = {
  timeZoneId: string
  lat: number
  lng: number
  city: string | null
  state: string | null
  countryCode: string | null
  postalCode: string | null
  placeId: string | null
  formattedAddress: string | null
  name: string | null
}

async function fetchAutocomplete(args: {
  input: string
  sessionToken: string
}) {
  const url = new URL('/api/google/places/autocomplete', 'http://localhost')
  url.searchParams.set('input', args.input)
  url.searchParams.set('sessionToken', args.sessionToken)
  url.searchParams.set('components', 'country:us')

  const res = await fetch(`${url.pathname}${url.search}`, { cache: 'no-store' })
  const data = await safeJsonRecord(res)

  if (!res.ok) {
    throw new Error(readErrorMessage(data) ?? 'Location search failed.')
  }

  const predsRaw =
    data && Array.isArray(data.predictions) ? data.predictions : []
  const out: GooglePrediction[] = []

  for (const p of predsRaw) {
    if (!isRecord(p)) continue

    const placeId = typeof p.placeId === 'string' ? p.placeId.trim() : ''
    const description =
      typeof p.description === 'string' ? p.description.trim() : ''
    if (!placeId || !description) continue

    out.push({
      placeId,
      description,
      mainText: typeof p.mainText === 'string' ? p.mainText : '',
      secondaryText: typeof p.secondaryText === 'string' ? p.secondaryText : '',
    })
  }

  return out
}

async function fetchPlaceDetails(args: {
  placeId: string
  sessionToken: string
}) {
  const url = new URL('/api/google/places/details', 'http://localhost')
  url.searchParams.set('placeId', args.placeId)
  url.searchParams.set('sessionToken', args.sessionToken)

  const res = await fetch(`${url.pathname}${url.search}`, { cache: 'no-store' })
  const data = await safeJsonRecord(res)

  if (!res.ok) {
    throw new Error(
      readErrorMessage(data) ?? 'Could not confirm selected location.',
    )
  }

  const place = data && isRecord(data.place) ? data.place : null

  return {
    placeId: typeof place?.placeId === 'string' ? place.placeId : args.placeId,
    name: typeof place?.name === 'string' ? place.name : null,
    formattedAddress:
      typeof place?.formattedAddress === 'string'
        ? place.formattedAddress
        : null,
    lat: typeof place?.lat === 'number' ? place.lat : null,
    lng: typeof place?.lng === 'number' ? place.lng : null,
    city: typeof place?.city === 'string' ? place.city : null,
    state: typeof place?.state === 'string' ? place.state : null,
    postalCode:
      typeof place?.postalCode === 'string' ? place.postalCode : null,
    countryCode:
      typeof place?.countryCode === 'string' ? place.countryCode : null,
  }
}

async function fetchGeocodeByPostal(args: { postalCode: string }) {
  const url = new URL('/api/google/geocode', 'http://localhost')
  url.searchParams.set('postalCode', args.postalCode)
  url.searchParams.set('components', 'country:us')

  const res = await fetch(`${url.pathname}${url.search}`, { cache: 'no-store' })
  const data = await safeJsonRecord(res)

  if (!res.ok) throw new Error(readErrorMessage(data) ?? 'ZIP lookup failed.')

  const geo = data && isRecord(data.geo) ? data.geo : null
  const lat = typeof geo?.lat === 'number' ? geo.lat : null
  const lng = typeof geo?.lng === 'number' ? geo.lng : null
  const postalCode =
    typeof geo?.postalCode === 'string' ? geo.postalCode : null
  const city = typeof geo?.city === 'string' ? geo.city : null
  const state = typeof geo?.state === 'string' ? geo.state : null
  const countryCode =
    typeof geo?.countryCode === 'string' ? geo.countryCode : null

  if (lat == null || lng == null) {
    throw new Error('ZIP lookup returned no coordinates.')
  }
  if (!postalCode) {
    throw new Error('ZIP lookup did not resolve a valid postal code.')
  }

  return { lat, lng, postalCode, city, state, countryCode }
}

async function fetchTimeZoneId(args: { lat: number; lng: number }) {
  const url = new URL('/api/google/timezone', 'http://localhost')
  url.searchParams.set('lat', String(args.lat))
  url.searchParams.set('lng', String(args.lng))

  const res = await fetch(`${url.pathname}${url.search}`, { cache: 'no-store' })
  const data = await safeJsonRecord(res)

  if (!res.ok) {
    throw new Error(readErrorMessage(data) ?? 'Timezone lookup failed.')
  }

  const tz = typeof data?.timeZoneId === 'string' ? data.timeZoneId.trim() : ''
  if (!tz) throw new Error('No timezone returned.')
  return tz
}

export default function SignupProClient() {
  const router = useRouter()
  const sp = useSearchParams()
  const { brand } = useBrand()

  const {
    ti,
    from,
    nextFromQuery,
    intent,
    inviteToken,
    emailPrefill,
    phonePrefill,
    nameParts,
  } = useMemo(() => readSignupForwardedParams(sp), [sp])

  const loginHref = useMemo(
    () =>
      buildLoginHref({
        role: 'PRO',
        ti,
        from,
        next: nextFromQuery,
        intent,
        inviteToken,
        email: emailPrefill || null,
        phone: phonePrefill || null,
      }),
    [ti, from, nextFromQuery, intent, inviteToken, emailPrefill, phonePrefill],
  )

  const [firstName, setFirstName] = useState(nameParts.firstName)
  const [lastName, setLastName] = useState(nameParts.lastName)
  const [phone, setPhone] = useState(() => formatPhoneInputValue(phonePrefill))
  const [email, setEmail] = useState(emailPrefill)
  const [password, setPassword] = useState('')
  const [tosAccepted, setTosAccepted] = useState(false)
  const [transactionalSmsConsent, setTransactionalSmsConsent] = useState(false)

  const [businessName, setBusinessName] = useState('')
  const [handle, setHandle] = useState('')
  const [professionType, setProfessionType] =
    useState<ProfessionType>('COSMETOLOGIST')
  const [proMode, setProMode] = useState<'SALON' | 'MOBILE'>('SALON')
  const [mobileRadiusMiles, setMobileRadiusMiles] = useState('15')
  const [licenseState, setLicenseState] = useState<string>('')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [licenseExpiry, setLicenseExpiry] = useState('')

  const sessionToken = useMemo(
    () =>
      globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : String(Date.now()),
    [],
  )

  const [locQuery, setLocQuery] = useState('')
  const [locPredictions, setLocPredictions] = useState<GooglePrediction[]>([])
  const [locLoading, setLocLoading] = useState(false)
  const [confirmed, setConfirmed] = useState<ConfirmedLocation | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<ProField, string>>
  >({})
  const [loading, setLoading] = useState(false)
  const [captchaChallengeActive, setCaptchaChallengeActive] = useState(false)
  const captchaHostRef = useRef<HTMLDivElement | null>(null)
  const [step, setStep] = useState(0)

  function setFieldError(field: ProField, message: string | null) {
    setFieldErrors((prev) => {
      const next = { ...prev }
      if (message) next[field] = message
      else delete next[field]
      return next
    })
  }

  // Whether a credential is required depends on BOTH profession and state.
  const needsLicense = Boolean(licenseState) && requiresLicense(professionType, licenseState)
  const licenseRequirement = licenseState
    ? getLicenseRequirement(professionType, licenseState)
    : null

  function resetLocation(nextQuery = '') {
    setLocQuery(nextQuery)
    setLocPredictions([])
    setConfirmed(null)
    setFieldError('location', null)
  }

  function locationLabel() {
    return proMode === 'MOBILE' ? 'Base ZIP code' : 'Salon / Suite address'
  }

  function locationPlaceholder() {
    return proMode === 'MOBILE'
      ? 'Enter your ZIP code (e.g. 92101)'
      : 'Search your salon / suite address'
  }

  function isLocationConfirmed() {
    if (!confirmed) return false
    if (proMode === 'MOBILE') return Boolean(confirmed.postalCode)
    return Boolean(confirmed.placeId) && Boolean(confirmed.formattedAddress)
  }

  async function refreshPredictions(input: string) {
    setFieldError('location', null)
    setConfirmed(null)

    if (proMode === 'MOBILE') {
      setLocQuery(input)
      setLocPredictions([])
      return
    }

    setLocQuery(input)
    const trimmed = input.trim()
    if (trimmed.length < 2) {
      setLocPredictions([])
      return
    }

    setLocLoading(true)
    try {
      const preds = await fetchAutocomplete({ input: trimmed, sessionToken })
      setLocPredictions(preds.slice(0, 6))
    } catch (e: unknown) {
      setLocPredictions([])
      setFieldError(
        'location',
        e instanceof Error
          ? e.message
          : 'Location search is unavailable right now.',
      )
    } finally {
      setLocLoading(false)
    }
  }

  async function pickPrediction(p: GooglePrediction) {
    setFieldError('location', null)
    setLocLoading(true)

    try {
      const details = await fetchPlaceDetails({
        placeId: p.placeId,
        sessionToken,
      })
      if (details.lat == null || details.lng == null) {
        throw new Error('Selected place is missing coordinates.')
      }

      const tz = await fetchTimeZoneId({ lat: details.lat, lng: details.lng })

      setConfirmed({
        timeZoneId: tz,
        lat: details.lat,
        lng: details.lng,
        city: details.city,
        state: details.state,
        countryCode: details.countryCode,
        postalCode: details.postalCode,
        placeId: details.placeId,
        formattedAddress: details.formattedAddress,
        name: details.name,
      })

      setLocPredictions([])
      setLocQuery(p.description)
    } catch (e: unknown) {
      setConfirmed(null)
      setFieldError(
        'location',
        e instanceof Error ? e.message : 'Could not confirm location.',
      )
    } finally {
      setLocLoading(false)
    }
  }

  async function confirmZip() {
    setFieldError('location', null)

    const raw = locQuery.trim()
    if (!isUsZip(raw)) {
      setFieldError('location', 'Please enter a valid 5-digit ZIP code.')
      return
    }

    setLocLoading(true)
    try {
      const geo = await fetchGeocodeByPostal({ postalCode: raw })
      const tz = await fetchTimeZoneId({ lat: geo.lat, lng: geo.lng })

      setConfirmed({
        timeZoneId: tz,
        lat: geo.lat,
        lng: geo.lng,
        city: geo.city,
        state: geo.state,
        countryCode: geo.countryCode,
        postalCode: geo.postalCode,
        placeId: null,
        formattedAddress: null,
        name: null,
      })

      setLocPredictions([])
      setLocQuery(geo.postalCode ?? raw)
    } catch (e: unknown) {
      setConfirmed(null)
      setFieldError(
        'location',
        e instanceof Error ? e.message : 'Could not confirm ZIP code.',
      )
    } finally {
      setLocLoading(false)
    }
  }

  function validateFields(
    fields: readonly ProField[],
  ): Partial<Record<ProField, string>> {
    const errors: Partial<Record<ProField, string>> = {}

    for (const field of fields) {
      switch (field) {
        case 'location':
          if (!isLocationConfirmed() || !confirmed) {
            errors.location =
              proMode === 'MOBILE'
                ? 'Please confirm your ZIP code.'
                : 'Please choose an address from the dropdown.'
          }
          break
        case 'radius':
          if (proMode === 'MOBILE') {
            const n = Number(mobileRadiusMiles)
            if (!Number.isFinite(n) || n < 1 || n > 200) {
              errors.radius =
                'Please enter a mobile radius between 1 and 200 miles.'
            }
          }
          break
        case 'state':
          if (!licenseState) {
            errors.state = 'Please select your state.'
          }
          break
        case 'licenseNumber':
          if (needsLicense && !licenseNumber.trim()) {
            errors.licenseNumber =
              licenseRequirement === 'REGISTERED'
                ? 'Registration number is required for this profession in your state.'
                : 'License number is required for this profession in your state.'
          }
          break
        case 'firstName':
          if (!firstName.trim()) errors.firstName = 'First name is required.'
          break
        case 'lastName':
          if (!lastName.trim()) errors.lastName = 'Last name is required.'
          break
        case 'phone':
          if (!compactPhoneInputForSubmit(phone)) {
            errors.phone = 'Phone number is required.'
          } else if (!isLikelyValidPhoneInput(phone)) {
            errors.phone = 'Enter a valid phone number.'
          }
          break
        case 'smsConsent':
          if (!transactionalSmsConsent) {
            errors.smsConsent =
              'Required so we can send verification codes and appointment updates.'
          }
          break
        case 'email':
          if (!email.trim()) errors.email = 'Email is required.'
          break
        case 'password':
          if (!password.trim()) {
            errors.password = 'Password is required.'
          } else if (password.length < PASSWORD_MIN_LEN) {
            errors.password = `Password must be at least ${PASSWORD_MIN_LEN} characters.`
          }
          break
        case 'tos':
          if (!tosAccepted) {
            errors.tos = 'Please accept the Terms and Privacy Policy.'
          }
          break
      }
    }

    return errors
  }

  /**
   * Renders the errors, jumps to the step owning the first invalid field,
   * and focuses it. Returns true when anything was invalid.
   */
  function surfaceErrors(
    errors: Partial<Record<ProField, string>>,
  ): boolean {
    setFieldErrors(errors)

    const firstInvalid = FIELD_ORDER.find((field) => errors[field])
    if (!firstInvalid) return false

    const targetStep = stepOfField(firstInvalid)
    if (targetStep !== step) setStep(targetStep)

    // Defer so the field exists when a step change re-renders the form.
    window.setTimeout(() => focusFieldById(FIELD_IDS[firstInvalid]), 0)
    return true
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)

    if (step < LAST_STEP) {
      if (surfaceErrors(validateFields(STEP_FIELDS[step] ?? []))) return
      setStep(step + 1)
      return
    }

    if (surfaceErrors(validateFields(FIELD_ORDER))) return

    // Unreachable when validation passed; narrows the type for the body below.
    if (!confirmed) return

    const signupLocation =
      proMode === 'MOBILE'
        ? {
            kind: 'PRO_MOBILE' as const,
            postalCode: confirmed.postalCode ?? locQuery.trim(),
            city: confirmed.city,
            state: confirmed.state,
            countryCode: confirmed.countryCode,
            lat: confirmed.lat,
            lng: confirmed.lng,
            timeZoneId: confirmed.timeZoneId,
          }
        : {
            kind: 'PRO_SALON' as const,
            placeId: confirmed.placeId!,
            formattedAddress: confirmed.formattedAddress ?? locQuery.trim(),
            city: confirmed.city,
            state: confirmed.state,
            postalCode: confirmed.postalCode,
            countryCode: confirmed.countryCode,
            lat: confirmed.lat,
            lng: confirmed.lng,
            timeZoneId: confirmed.timeZoneId,
            name: confirmed.name,
          }

    setLoading(true)
    try {
      const turnstileToken = await getTurnstileToken('signup_pro', {
        container: captchaHostRef.current,
        onInteractiveChallenge: () => setCaptchaChallengeActive(true),
      })
      setCaptchaChallengeActive(false)

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          role: 'PRO',
          firstName,
          lastName,
          phone: compactPhoneInputForSubmit(phone),
          tapIntentId: ti ?? undefined,
          next: nextFromQuery ?? undefined,
          intent: intent ?? undefined,
          inviteToken: inviteToken ?? undefined,
          businessName: businessName.trim()
            ? businessName.trim()
            : undefined,
          handle: handle.trim()
            ? sanitizeHandleInput(handle.trim())
            : undefined,
          professionType,
          mobileRadiusMiles:
            proMode === 'MOBILE' ? Number(mobileRadiusMiles) : undefined,
          licenseState: licenseState || undefined,
          licenseNumber: needsLicense
            ? licenseNumber.trim().toUpperCase()
            : undefined,
          licenseExpiry: needsLicense && licenseExpiry ? licenseExpiry : undefined,
          signupLocation,
          transactionalSmsConsent,
          tosAccepted: true,
          turnstileToken,
        }),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        setError(readErrorMessage(data) ?? 'Signup failed.')
        return
      }

      router.refresh()

      const responseNextUrl = sanitizeNextUrl(readStringField(data, 'nextUrl'))
      const nextUrl = responseNextUrl ?? nextFromQuery
      const emailVerificationSent = readVerificationSendState(
        data,
        'emailVerificationSent',
      )
      const phoneVerificationSent = readVerificationSendState(
        data,
        'phoneVerificationSent',
      )

      const verifyPhoneUrl = buildVerifyPhoneUrl({
        nextUrl,
        emailVerificationSent,
        phoneVerificationSent,
      })

      hardNavigate(verifyPhoneUrl)
    } catch (err: unknown) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Signup failed.')
    } finally {
      setCaptchaChallengeActive(false)
      setLoading(false)
    }
  }

  const handlePreview = sanitizeHandleInput(handle.trim())
  const handleIsTrimmed = handle.trim() !== handlePreview

  return (
    <AuthShell
      title="Create Pro Account"
      subtitle="Run your business from your phone — set up takes minutes."
    >
      <form onSubmit={handleSubmit} className="grid gap-5" noValidate>
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-black tracking-wide text-textSecondary">
              Step {step + 1} of {STEP_LABELS.length}
            </span>
            <span className="text-xs font-black text-textPrimary">
              {STEP_LABELS[step]}
            </span>
          </div>
          <div className="flex gap-1.5" aria-hidden="true">
            {STEP_LABELS.map((label, index) => (
              <div
                key={label}
                className={cn(
                  'h-1 flex-1 rounded-full transition',
                  index <= step ? 'bg-accentPrimary/60' : 'bg-surfaceGlass/15',
                )}
              />
            ))}
          </div>
        </div>

        {step === 0 ? (
          <>
        <div className="grid gap-2">
          <FieldLabel>Profession</FieldLabel>
          <Select
            value={professionType}
            onChange={(e) => {
              const next = e.target.value as ProfessionType
              setProfessionType(next)
              setError(null)
            }}
          >
            <option value="COSMETOLOGIST">Cosmetologist</option>
            <option value="BARBER">Barber</option>
            <option value="ESTHETICIAN">Esthetician</option>
            <option value="MANICURIST">Manicurist</option>
            <option value="HAIRSTYLIST">Hairstylist</option>
            <option value="ELECTROLOGIST">Electrologist</option>
            <option value="MASSAGE_THERAPIST">Massage therapist</option>
            <option value="MAKEUP_ARTIST">Makeup artist</option>
            <option value="LASH_TECHNICIAN">Lash technician</option>
            <option value="HAIR_BRAIDER">Hair braider</option>
            <option value="PERMANENT_MAKEUP_ARTIST">Permanent makeup artist</option>
          </Select>

        </div>

        <div className="grid gap-2">
          <label className="grid gap-1.5">
            <FieldLabel>State you’re licensed / operating in</FieldLabel>
            <Select
              id={FIELD_IDS.state}
              value={licenseState}
              onChange={(e) => {
                setLicenseState(e.target.value)
                setFieldError('state', null)
                setError(null)
              }}
              {...fieldErrorDescribedBy(FIELD_IDS.state, fieldErrors.state)}
            >
              <option value="">Select your state…</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </Select>
          </label>
          <FieldErrorText
            id={`${FIELD_IDS.state}-error`}
            message={fieldErrors.state}
          />
          {licenseState && !needsLicense ? (
            <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 px-3 py-2 text-xs text-textSecondary">
              No state license is required for this profession in{' '}
              <span className="font-black text-textPrimary">
                {stateName(licenseState)}
              </span>
              . After signup you’ll upload a certificate and photo ID on the{' '}
              <span className="font-black text-textPrimary">Verification</span>{' '}
              page of your pro dashboard.
            </div>
          ) : null}
        </div>

        <div className="grid gap-2">
          <FieldLabel>Where do you offer services?</FieldLabel>
          <div className={cn('grid grid-cols-2 gap-2')}>
            <button
              type="button"
              onClick={() => {
                setProMode('SALON')
                setError(null)
                resetLocation('')
              }}
              className={cn(
                'rounded-full border px-3 py-2 text-xs font-black transition',
                proMode === 'SALON'
                  ? 'border-accentPrimary/35 bg-accentPrimary/14 text-textPrimary'
                  : 'border-surfaceGlass/14 bg-bgPrimary/25 text-textSecondary hover:text-textPrimary',
              )}
            >
              In salon / suite
            </button>
            <button
              type="button"
              onClick={() => {
                setProMode('MOBILE')
                setError(null)
                resetLocation('')
              }}
              className={cn(
                'rounded-full border px-3 py-2 text-xs font-black transition',
                proMode === 'MOBILE'
                  ? 'border-accentPrimary/35 bg-accentPrimary/14 text-textPrimary'
                  : 'border-surfaceGlass/14 bg-bgPrimary/25 text-textSecondary hover:text-textPrimary',
              )}
            >
              Mobile
            </button>
          </div>
        </div>

        <div className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>{locationLabel()}</FieldLabel>
            {confirmed?.timeZoneId ? (
              <span className="text-[11px] font-black text-textSecondary/80">
                {friendlyTimeZoneLabel(confirmed.timeZoneId) ?? confirmed.timeZoneId}
              </span>
            ) : null}
          </div>

          <div className="relative">
            <Input
              id={FIELD_IDS.location}
              value={locQuery}
              onChange={(e) => refreshPredictions(e.target.value)}
              placeholder={locationPlaceholder()}
              autoComplete="off"
              inputMode={proMode === 'MOBILE' ? 'numeric' : 'text'}
              {...fieldErrorDescribedBy(
                FIELD_IDS.location,
                fieldErrors.location,
              )}
            />

            {proMode === 'SALON' && locPredictions.length > 0 ? (
              <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-card border border-surfaceGlass/12 bg-bgPrimary/60 tovis-glass-soft">
                <div className="max-h-64 overflow-auto p-1">
                  {locPredictions.map((p) => (
                    <button
                      key={p.placeId}
                      type="button"
                      onClick={() => pickPrediction(p)}
                      className={cn(
                        'w-full rounded-card px-3 py-2 text-left transition',
                        'hover:bg-bgPrimary/35 focus:outline-none focus:ring-2 focus:ring-accentPrimary/15',
                      )}
                    >
                      <div className="text-sm font-black text-textPrimary">
                        {p.mainText || p.description}
                      </div>
                      <div className="text-xs text-textSecondary/80">
                        {p.secondaryText}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-3">
            {locLoading ? <HelpText>Confirming…</HelpText> : <span />}

            {isLocationConfirmed() ? (
              <span className="text-xs font-black text-accentPrimary">
                Confirmed
              </span>
            ) : proMode === 'MOBILE' ? (
              <button
                type="button"
                onClick={confirmZip}
                disabled={locLoading || !locQuery.trim()}
                className={cn(
                  'inline-flex items-center justify-center rounded-full border px-3 py-1 text-xs font-black transition',
                  'border-surfaceGlass/14 bg-bgPrimary/25 text-textPrimary',
                  'hover:border-surfaceGlass/20 hover:bg-bgPrimary/30',
                  'focus:outline-none focus:ring-2 focus:ring-accentPrimary/15',
                  (locLoading || !locQuery.trim()) &&
                    'cursor-not-allowed opacity-60',
                )}
              >
                Confirm ZIP
              </button>
            ) : (
              <HelpText>
                Pick your address from the dropdown to confirm.
              </HelpText>
            )}
          </div>

          <FieldErrorText
            id={`${FIELD_IDS.location}-error`}
            message={fieldErrors.location}
          />
        </div>

        {proMode === 'MOBILE' ? (
          <label className="grid gap-1.5">
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>Mobile radius (miles)</FieldLabel>
              <span className="text-xs font-black text-textSecondary/80">
                Required
              </span>
            </div>
            <Input
              id={FIELD_IDS.radius}
              value={mobileRadiusMiles}
              onChange={(e) => {
                setMobileRadiusMiles(e.target.value)
                setFieldError('radius', null)
              }}
              inputMode="numeric"
              placeholder="e.g. 15"
              required
              {...fieldErrorDescribedBy(FIELD_IDS.radius, fieldErrors.radius)}
            />
            <HelpText>How far you travel from your base ZIP.</HelpText>
            <FieldErrorText
              id={`${FIELD_IDS.radius}-error`}
              message={fieldErrors.radius}
            />
          </label>
        ) : null}

        {needsLicense ? (
          <div className="grid gap-3 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="font-black text-textPrimary">
                {stateName(licenseState)}{' '}
                {licenseRequirement === 'REGISTERED' ? 'registration' : 'license'}
              </div>
              <span className="text-xs font-black text-textSecondary/80">
                Required
              </span>
            </div>

            <label className="grid gap-1.5">
              <FieldLabel>
                {licenseRequirement === 'REGISTERED'
                  ? 'Registration number'
                  : 'License number'}
              </FieldLabel>
              <Input
                id={FIELD_IDS.licenseNumber}
                value={licenseNumber}
                onChange={(e) => {
                  setLicenseNumber(e.target.value)
                  setFieldError('licenseNumber', null)
                }}
                placeholder="e.g. 123456"
                autoCapitalize="characters"
                {...fieldErrorDescribedBy(
                  FIELD_IDS.licenseNumber,
                  fieldErrors.licenseNumber,
                )}
              />
              <FieldErrorText
                id={`${FIELD_IDS.licenseNumber}-error`}
                message={fieldErrors.licenseNumber}
              />
            </label>

            <label className="grid gap-1.5">
              <FieldLabel>Expiration date</FieldLabel>
              <Input
                type="date"
                value={licenseExpiry}
                onChange={(e) => setLicenseExpiry(e.target.value)}
              />
              <HelpText>
                Optional now — you’ll need it (plus a license photo) before an
                admin can approve you.
              </HelpText>
            </label>

            <div className="rounded-card border border-surfaceGlass/12 bg-bgPrimary/25 px-3 py-2 text-xs text-textSecondary">
              {supportsOnlineVerification(professionType, licenseState)
                ? 'We’ll try to verify your license automatically. If verification is unavailable, you’ll upload a license photo'
                : 'We’ll review your credential after signup. You’ll upload a photo'}
              <span className="font-black text-textPrimary"> after signup</span>{' '}
              on the Verification page of your pro dashboard for admin approval.
              <div className="mt-1">
                You can still set up services + your calendar immediately.
              </div>
            </div>
          </div>
        ) : null}

          </>
        ) : null}

        {step === 1 ? (
          <>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1.5">
            <FieldLabel>First name</FieldLabel>
            <Input
              id={FIELD_IDS.firstName}
              value={firstName}
              onChange={(e) => {
                setFirstName(e.target.value)
                setFieldError('firstName', null)
              }}
              required
              autoComplete="given-name"
              {...fieldErrorDescribedBy(
                FIELD_IDS.firstName,
                fieldErrors.firstName,
              )}
            />
            <FieldErrorText
              id={`${FIELD_IDS.firstName}-error`}
              message={fieldErrors.firstName}
            />
          </label>

          <label className="grid gap-1.5">
            <FieldLabel>Last name</FieldLabel>
            <Input
              id={FIELD_IDS.lastName}
              value={lastName}
              onChange={(e) => {
                setLastName(e.target.value)
                setFieldError('lastName', null)
              }}
              required
              autoComplete="family-name"
              {...fieldErrorDescribedBy(
                FIELD_IDS.lastName,
                fieldErrors.lastName,
              )}
            />
            <FieldErrorText
              id={`${FIELD_IDS.lastName}-error`}
              message={fieldErrors.lastName}
            />
          </label>
        </div>

        <label className="grid gap-1.5">
          <FieldLabel>Business name (optional)</FieldLabel>
          <Input
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
            placeholder={`e.g. Salon De ${brand.displayName}`}
            autoComplete="organization"
          />
          <HelpText>You can add this later — we won’t block signup.</HelpText>
        </label>

        <label className="grid gap-1.5">
          <FieldLabel>Handle (optional)</FieldLabel>
          <Input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder={`e.g. iLove${brand.displayName}`}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <HelpText>
            Optional for now. If you enter one, it will be normalized to{' '}
            <span className="font-black text-textPrimary">
              {handlePreview || 'your-handle'}
            </span>
            {handleIsTrimmed ? (
              <span className="text-toneWarn"> (we’ll trim symbols)</span>
            ) : null}
          </HelpText>
        </label>

        <label className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>Phone</FieldLabel>
            <span className="text-xs font-black text-textSecondary/80">
              Required
            </span>
          </div>
          <Input
            id={FIELD_IDS.phone}
            value={phone}
            onChange={(e) => {
              setPhone(formatPhoneInputValue(e.target.value))
              setFieldError('phone', null)
            }}
            inputMode="tel"
            autoComplete="tel"
            placeholder="+1 (___) ___-____"
            required
            {...fieldErrorDescribedBy(FIELD_IDS.phone, fieldErrors.phone)}
          />
          <FieldErrorText
            id={`${FIELD_IDS.phone}-error`}
            message={fieldErrors.phone}
          />
        </label>

        <label className="flex items-start gap-3 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 px-3 py-3 text-sm text-textSecondary">
          <input
            id={FIELD_IDS.smsConsent}
            type="checkbox"
            checked={transactionalSmsConsent}
            onChange={(e) => {
              setTransactionalSmsConsent(e.target.checked)
              setFieldError('smsConsent', null)
            }}
            className="mt-0.5 h-4 w-4 rounded border-surfaceGlass/20"
            required
            {...fieldErrorDescribedBy(
              FIELD_IDS.smsConsent,
              fieldErrors.smsConsent,
            )}
          />
          <span className="leading-5">
            {buildTransactionalSmsCheckboxLabel(brand.displayName)}
            <FieldErrorText
              id={`${FIELD_IDS.smsConsent}-error`}
              message={fieldErrors.smsConsent}
            />
          </span>
        </label>
          </>
        ) : null}

        {step === LAST_STEP ? (
          <>
        <label className="grid gap-1.5">
          <FieldLabel>Email address</FieldLabel>
          <Input
            id={FIELD_IDS.email}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setFieldError('email', null)
            }}
            type="email"
            required
            autoComplete="email"
            inputMode="email"
            {...fieldErrorDescribedBy(FIELD_IDS.email, fieldErrors.email)}
          />
          <FieldErrorText
            id={`${FIELD_IDS.email}-error`}
            message={fieldErrors.email}
          />
        </label>

        <label className="grid gap-1.5">
          <FieldLabel>Password</FieldLabel>
          <PasswordInput
            id={FIELD_IDS.password}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setFieldError('password', null)
            }}
            required
            autoComplete="new-password"
            {...fieldErrorDescribedBy(
              FIELD_IDS.password,
              fieldErrors.password,
            )}
          />
          <HelpText>At least {PASSWORD_MIN_LEN} characters.</HelpText>
          <FieldErrorText
            id={`${FIELD_IDS.password}-error`}
            message={fieldErrors.password}
          />
        </label>

        <label className="flex items-start gap-3 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 px-3 py-3 text-sm text-textSecondary">
          <input
            id={FIELD_IDS.tos}
            type="checkbox"
            checked={tosAccepted}
            onChange={(e) => {
              setTosAccepted(e.target.checked)
              setFieldError('tos', null)
            }}
            className="mt-0.5 h-4 w-4 rounded border-surfaceGlass/20"
            required
            {...fieldErrorDescribedBy(FIELD_IDS.tos, fieldErrors.tos)}
          />
          <span className="leading-5">
            I agree to the{' '}
            <Link
              className="font-black text-textPrimary hover:text-accentPrimary"
              href="/terms"
            >
              Terms
            </Link>{' '}
            and{' '}
            <Link
              className="font-black text-textPrimary hover:text-accentPrimary"
              href="/privacy"
            >
              Privacy Policy
            </Link>
            .
            <span className="mt-1 block text-[11px] text-textSecondary/80">
              Protected by Turnstile.
            </span>
            <FieldErrorText
              id={`${FIELD_IDS.tos}-error`}
              message={fieldErrors.tos}
            />
          </span>
        </label>
          </>
        ) : null}

        {error ? (
          <div className="rounded-card border border-toneDanger/25 bg-toneDanger/10 px-3 py-2 text-sm font-bold text-toneDanger">
            {error}
          </div>
        ) : null}

        <div className="grid gap-2 pt-1">
          {captchaChallengeActive ? (
            <p className="text-sm font-bold">
              Complete the security check below to continue.
            </p>
          ) : null}
          <div ref={captchaHostRef} className="justify-self-center empty:hidden" />

          <PrimaryButton loading={loading}>
            {step < LAST_STEP
              ? 'Continue'
              : loading
                ? 'Creating…'
                : 'Create Pro Account'}
          </PrimaryButton>

          {step > 0 ? (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className={cn(
                'inline-flex w-full items-center justify-center rounded-full border px-4 py-2 text-sm font-black transition',
                'border-surfaceGlass/14 bg-bgPrimary/25 text-textPrimary',
                'hover:border-surfaceGlass/20 hover:bg-bgPrimary/30',
                'focus:outline-none focus:ring-2 focus:ring-accentPrimary/15',
              )}
            >
              Back
            </button>
          ) : null}

          <SecondaryLinkButton href={loginHref}>Sign in</SecondaryLinkButton>
        </div>
      </form>
    </AuthShell>
  )
}
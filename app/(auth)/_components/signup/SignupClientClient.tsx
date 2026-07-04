// app/(auth)/_components/signup/SignupClientClient.tsx
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
import SocialSignIn from '../social/SocialSignIn'
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
import { PASSWORD_MIN_LEN } from '@/lib/passwordPolicyConstants'
import {
  compactPhoneInputForSubmit,
  formatPhoneInputValue,
  isLikelyValidPhoneInput,
} from '@/lib/phoneInputFormat'

type VerificationSendState = boolean | 'pending'

type ClientField =
  | 'firstName'
  | 'lastName'
  | 'zip'
  | 'phone'
  | 'smsConsent'
  | 'email'
  | 'password'
  | 'tos'

const FIELD_IDS: Record<ClientField, string> = {
  firstName: 'signup-first-name',
  lastName: 'signup-last-name',
  zip: 'signup-zip',
  phone: 'signup-phone',
  smsConsent: 'signup-sms-consent',
  email: 'signup-email',
  password: 'signup-password',
  tos: 'signup-tos',
}

const FIELD_ORDER: ClientField[] = [
  'firstName',
  'lastName',
  'zip',
  'phone',
  'smsConsent',
  'email',
  'password',
  'tos',
]

type GeocodeResponse = {
  geo?: {
    lat?: number
    lng?: number
    postalCode?: string
    city?: string
    state?: string
    countryCode?: string
  }
  error?: string
}

type TimeZoneResponse = {
  timeZoneId?: string
  error?: string
}

function readVerificationSendState(
  data: Record<string, unknown> | null,
  key: string,
): VerificationSendState {
  const value = data?.[key]
  if (value === 'pending') return 'pending'
  return value === true
}

function isUsZip(raw: string) {
  const s = raw.trim()
  return /^\d{5}(-\d{4})?$/.test(s)
}

type ConfirmedZip = {
  timeZoneId: string
  lat: number
  lng: number
  city: string | null
  state: string | null
  countryCode: string | null
  postalCode: string
}

async function fetchGeocodeByPostal(args: { postalCode: string }) {
  const url = new URL('/api/v1/google/geocode', 'http://localhost')
  url.searchParams.set('postalCode', args.postalCode)
  url.searchParams.set('components', 'country:us')

  const res = await fetch(`${url.pathname}${url.search}`, { cache: 'no-store' })
  const raw = (await res.json().catch(() => null)) as GeocodeResponse | null
  const geo = raw?.geo

  if (!res.ok) {
    throw new Error(raw?.error || 'ZIP lookup failed.')
  }

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
  const url = new URL('/api/v1/google/timezone', 'http://localhost')
  url.searchParams.set('lat', String(args.lat))
  url.searchParams.set('lng', String(args.lng))

  const res = await fetch(`${url.pathname}${url.search}`, { cache: 'no-store' })
  const raw = (await res.json().catch(() => null)) as TimeZoneResponse | null

  if (!res.ok) {
    throw new Error(raw?.error || 'Timezone lookup failed.')
  }

  const tz = typeof raw?.timeZoneId === 'string' ? raw.timeZoneId : ''
  if (!tz) throw new Error('No timezone returned.')
  return tz
}

export default function SignupClientClient() {
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
        role: 'CLIENT',
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

  const isClaimInviteFlow = intent === 'CLAIM_INVITE'

  const [firstName, setFirstName] = useState(nameParts.firstName)
  const [lastName, setLastName] = useState(nameParts.lastName)

  const [zip, setZip] = useState('')
  const [zipLoading, setZipLoading] = useState(false)
  const [confirmed, setConfirmed] = useState<ConfirmedZip | null>(null)

  const [phone, setPhone] = useState(() => formatPhoneInputValue(phonePrefill))
  const [email, setEmail] = useState(emailPrefill)
  const [password, setPassword] = useState('')
  const [tosAccepted, setTosAccepted] = useState(false)
  const [transactionalSmsConsent, setTransactionalSmsConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<ClientField, string>>
  >({})
  const [loading, setLoading] = useState(false)
  const [captchaChallengeActive, setCaptchaChallengeActive] = useState(false)
  const captchaHostRef = useRef<HTMLDivElement | null>(null)

  function setFieldError(field: ClientField, message: string | null) {
    setFieldErrors((prev) => {
      const next = { ...prev }
      if (message) next[field] = message
      else delete next[field]
      return next
    })
  }

  function resetZip(next = '') {
    setZip(next)
    setConfirmed(null)
  }

  type ZipConfirmResult = {
    confirmed: ConfirmedZip | null
    errorMessage: string | null
  }

  async function confirmZipIfValid(
    rawInput?: string,
  ): Promise<ZipConfirmResult> {
    const raw = (rawInput ?? zip).trim()

    if (!raw) return { confirmed: null, errorMessage: null }

    if (confirmed?.postalCode && confirmed.postalCode === raw) {
      return { confirmed, errorMessage: null }
    }

    if (!isUsZip(raw)) {
      setConfirmed(null)
      return {
        confirmed: null,
        errorMessage: 'Please enter a valid 5-digit ZIP code.',
      }
    }

    if (zipLoading) return { confirmed, errorMessage: null }

    setZipLoading(true)

    try {
      const geo = await fetchGeocodeByPostal({ postalCode: raw })
      const tz = await fetchTimeZoneId({ lat: geo.lat, lng: geo.lng })

      const nextConfirmed: ConfirmedZip = {
        timeZoneId: tz,
        lat: geo.lat,
        lng: geo.lng,
        city: geo.city,
        state: geo.state,
        countryCode: geo.countryCode,
        postalCode: geo.postalCode,
      }

      setConfirmed(nextConfirmed)
      setZip(geo.postalCode ?? raw)
      return { confirmed: nextConfirmed, errorMessage: null }
    } catch (e) {
      setConfirmed(null)
      return {
        confirmed: null,
        errorMessage:
          e instanceof Error ? e.message : 'Could not confirm ZIP code.',
      }
    } finally {
      setZipLoading(false)
    }
  }

  async function handleZipBlur() {
    const result = await confirmZipIfValid(zip)
    setFieldError('zip', result.errorMessage)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)

    const errors: Partial<Record<ClientField, string>> = {}

    if (!firstName.trim()) errors.firstName = 'First name is required.'
    if (!lastName.trim()) errors.lastName = 'Last name is required.'

    const zipResult = await confirmZipIfValid(zip)
    const confirmedZip = zipResult.confirmed
    if (!confirmedZip) {
      errors.zip = zipResult.errorMessage ?? 'Please confirm your ZIP code.'
    }

    if (!compactPhoneInputForSubmit(phone)) {
      errors.phone = 'Phone number is required.'
    } else if (!isLikelyValidPhoneInput(phone)) {
      errors.phone = 'Enter a valid phone number.'
    }

    if (!transactionalSmsConsent) {
      errors.smsConsent =
        'Required so we can send verification codes and appointment updates.'
    }
    if (!email.trim()) errors.email = 'Email is required.'
    if (!password.trim()) {
      errors.password = 'Password is required.'
    } else if (password.length < PASSWORD_MIN_LEN) {
      errors.password = `Password must be at least ${PASSWORD_MIN_LEN} characters.`
    }
    if (!tosAccepted) {
      errors.tos = 'Please accept the Terms and Privacy Policy.'
    }

    setFieldErrors(errors)

    const firstInvalid = FIELD_ORDER.find((field) => errors[field])
    if (firstInvalid) {
      focusFieldById(FIELD_IDS[firstInvalid])
      return
    }

    // Unreachable when validation passed; narrows the type for the body below.
    if (!confirmedZip) return

    setLoading(true)
    try {
      const turnstileToken = await getTurnstileToken('signup_client', {
        container: captchaHostRef.current,
        onInteractiveChallenge: () => setCaptchaChallengeActive(true),
      })
      setCaptchaChallengeActive(false)

      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          role: 'CLIENT',
          firstName,
          lastName,
          phone: compactPhoneInputForSubmit(phone),
          tosAccepted: true,
          transactionalSmsConsent,
          turnstileToken,
          tapIntentId: ti ?? undefined,
          next: nextFromQuery ?? undefined,
          intent: intent ?? undefined,
          inviteToken: inviteToken ?? undefined,
          signupLocation: {
            kind: 'CLIENT_ZIP',
            postalCode: confirmedZip.postalCode,
            city: confirmedZip.city,
            state: confirmedZip.state,
            countryCode: confirmedZip.countryCode,
            lat: confirmedZip.lat,
            lng: confirmedZip.lng,
            timeZoneId: confirmedZip.timeZoneId,
          },
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
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Signup failed.')
    } finally {
      setCaptchaChallengeActive(false)
      setLoading(false)
    }
  }

  return (
    <AuthShell
      title={
        isClaimInviteFlow
          ? 'Create Client Account to Claim Your History'
          : 'Create Client Account'
      }
      subtitle={
        isClaimInviteFlow
          ? 'Finish creating your client account so we can attach your booking history to the right identity.'
          : 'Find pros, book fast, and keep your beauty life organized.'
      }
    >
      <form onSubmit={handleSubmit} className="grid gap-5" noValidate>
        {isClaimInviteFlow ? (
          <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 px-3 py-2 text-xs text-textSecondary">
            <span className="font-black text-textPrimary">Claim invite:</span>{' '}
            Your account will return to the secure claim link after phone
            verification.
          </div>
        ) : null}

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

          <label className="grid gap-1.5 sm:col-span-2">
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>ZIP code</FieldLabel>
              {confirmed?.timeZoneId ? (
                <span className="text-[11px] font-black text-textSecondary/80">
                  {friendlyTimeZoneLabel(confirmed.timeZoneId) ?? confirmed.timeZoneId}
                </span>
              ) : null}
            </div>

            <Input
              id={FIELD_IDS.zip}
              value={zip}
              onChange={(e) => {
                const v = e.target.value
                setZip(v)
                setConfirmed(null)
                setFieldError('zip', null)
              }}
              onBlur={() => {
                void handleZipBlur()
              }}
              placeholder="e.g. 92024"
              inputMode="numeric"
              autoComplete="postal-code"
              {...fieldErrorDescribedBy(FIELD_IDS.zip, fieldErrors.zip)}
            />
            <FieldErrorText
              id={`${FIELD_IDS.zip}-error`}
              message={fieldErrors.zip}
            />

            <div className="flex items-center justify-between gap-3">
              {zipLoading ? (
                <HelpText>Confirming…</HelpText>
              ) : (
                <HelpText>We’ll confirm this when you leave the field.</HelpText>
              )}
              {confirmed ? (
                <span className="text-xs font-black text-accentPrimary">
                  Confirmed
                </span>
              ) : null}
            </div>

            {confirmed && (confirmed.city || confirmed.state) ? (
              <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 px-3 py-2 text-xs text-textSecondary">
                <span className="font-black text-textPrimary">Near:</span>{' '}
                <span>
                  {[confirmed.city, confirmed.state].filter(Boolean).join(', ')}
                </span>
                <button
                  type="button"
                  className="ml-3 text-xs font-black text-textPrimary/80 hover:text-textPrimary"
                  onClick={() => resetZip(zip)}
                >
                  Change
                </button>
              </div>
            ) : null}
          </label>
        </div>

        <div className="h-px w-full bg-surfaceGlass/10" />

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
            {loading ? 'Creating…' : 'Create Client Account'}
          </PrimaryButton>

          <SecondaryLinkButton href={loginHref}>
            {isClaimInviteFlow ? 'I already have a client account' : 'Sign in'}
          </SecondaryLinkButton>
        </div>
      </form>

      <div className="mt-4">
        <SocialSignIn />
      </div>
    </AuthShell>
  )
}
// app/(auth)/_components/signup/SignupProClient.tsx

'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import AuthNotice from '../AuthNotice'
import AuthShell from '../AuthShell'
import FieldLabel from '../FieldLabel'
import HelpText from '../HelpText'
import Input from '../Input'
import PasswordInput from '../PasswordInput'
import PrimaryButton from '../PrimaryButton'
import SecondaryLinkButton from '../SecondaryLinkButton'
import { cn } from '@/lib/utils'
import { sanitizeHandleInput } from '@/lib/handles'
import { safeJsonRecord, readErrorMessage, readStringField } from '@/lib/http'
import { hardNavigate } from '@/lib/clientNavigation'
import { getTurnstileToken } from '@/lib/turnstileClient'
import WorkLocationFields from './location/WorkLocationFields'
import { useWorkLocation } from './location/useWorkLocation'
import ProBrandingFields from './pro/ProBrandingFields'
import {
  licenseNumberRequiredMessage,
  proNeedsLicense,
  ProLicenseCard,
  ProProfessionFields,
} from './pro/ProCredentialFields'
import {
  buildVerifyPhoneUrl,
  readVerificationSendState,
} from './buildVerifyPhoneUrl'
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
import type { ProfessionType } from '@prisma/client'
import {
  compactPhoneInputForSubmit,
  formatPhoneInputValue,
  isLikelyValidPhoneInput,
} from '@/lib/phoneInputFormat'

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
  const [licenseState, setLicenseState] = useState<string>('')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [licenseExpiry, setLicenseExpiry] = useState('')

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

  const workLocation = useWorkLocation({
    onLocationError: (message) => setFieldError('location', message),
  })

  // Whether a credential is required depends on BOTH profession and state.
  const needsLicense = proNeedsLicense(professionType, licenseState)

  function validateFields(
    fields: readonly ProField[],
  ): Partial<Record<ProField, string>> {
    const errors: Partial<Record<ProField, string>> = {}

    for (const field of fields) {
      switch (field) {
        case 'location': {
          const message = workLocation.validateLocation()
          if (message) errors.location = message
          break
        }
        case 'radius': {
          const message = workLocation.validateRadius()
          if (message) errors.radius = message
          break
        }
        case 'state':
          if (!licenseState) {
            errors.state = 'Please select your state.'
          }
          break
        case 'licenseNumber':
          if (needsLicense && !licenseNumber.trim()) {
            errors.licenseNumber = licenseNumberRequiredMessage(
              professionType,
              licenseState,
            )
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
    const signupLocation = workLocation.toSignupLocation()
    if (!signupLocation) return

    setLoading(true)
    try {
      const turnstileToken = await getTurnstileToken('signup_pro', {
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
            workLocation.mode === 'MOBILE'
              ? Number(workLocation.radiusMiles)
              : undefined,
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
        <ProProfessionFields
          professionType={professionType}
          onProfessionChange={(next) => {
            setProfessionType(next)
            setError(null)
          }}
          licenseState={licenseState}
          onLicenseStateChange={(next) => {
            setLicenseState(next)
            setFieldError('state', null)
            setError(null)
          }}
          stateId={FIELD_IDS.state}
          stateError={fieldErrors.state}
        />

        <WorkLocationFields
          controller={workLocation}
          ids={{ location: FIELD_IDS.location, radius: FIELD_IDS.radius }}
          errors={{
            location: fieldErrors.location,
            radius: fieldErrors.radius,
          }}
          onErrorChange={setFieldError}
          onModeChange={() => setError(null)}
        />

        <ProLicenseCard
          professionType={professionType}
          licenseState={licenseState}
          licenseNumber={licenseNumber}
          onLicenseNumberChange={(next) => {
            setLicenseNumber(next)
            setFieldError('licenseNumber', null)
          }}
          licenseExpiry={licenseExpiry}
          onLicenseExpiryChange={setLicenseExpiry}
          licenseNumberId={FIELD_IDS.licenseNumber}
          licenseNumberError={fieldErrors.licenseNumber}
        />

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

        <ProBrandingFields
          businessName={businessName}
          onBusinessNameChange={setBusinessName}
          handle={handle}
          onHandleChange={setHandle}
        />

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

        {error ? <AuthNotice tone="danger">{error}</AuthNotice> : null}

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
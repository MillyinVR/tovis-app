// app/(auth)/_components/signup/SocialCompleteClient.tsx
//
// The second half of a social signup: the screen that collects everything a
// provider cannot tell us.
//
// Google and Apple prove ONE thing — that this person controls this email. A
// signup here needs several more: whether they are a client or a pro, a phone
// number (every booking notification rides on it), transactional-SMS consent,
// a ZIP or a work location, and for a pro a profession, a state and a
// credential. So the provider button hands back a single-use ticket and stops,
// and this form spends it at POST /api/v1/auth/social/complete.
//
// The ticket arrives through sessionStorage, never the URL — see
// ../social/socialSignupHandoff.ts for why. The claim params (intent /
// inviteToken / via / vsig) DO come through the URL and must be forwarded, or a
// person arriving from a pro's claim link silently loses the history that link
// exists to attach.

'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

import AuthNotice from '../AuthNotice'
import AuthShell from '../AuthShell'
import FieldLabel from '../FieldLabel'
import Input from '../Input'
import PrimaryButton from '../PrimaryButton'
import SecondaryLinkButton from '../SecondaryLinkButton'
import { cn } from '@/lib/utils'
import {
  safeJsonRecord,
  readBooleanField,
  readErrorMessage,
  readStringField,
} from '@/lib/http'
import { hardNavigate } from '@/lib/clientNavigation'
import { sanitizeHandleInput } from '@/lib/handles'
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
import ClientZipField from './location/ClientZipField'
import { clientZipToSignupLocation, useClientZip } from './location/useClientZip'
import type { ConfirmedZip } from './location/useClientZip'
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
  clearSocialSignup,
  readSocialSignup,
} from '../social/socialSignupHandoff'
import type {
  SocialProvider,
  SocialSignupHandoff,
} from '../social/submitSocialToken'
import { buildTransactionalSmsCheckboxLabel } from '@/lib/transactionalSmsPolicy'
import { useBrand } from '@/lib/brand/BrandProvider'
import {
  compactPhoneInputForSubmit,
  formatPhoneInputValue,
  isLikelyValidPhoneInput,
} from '@/lib/phoneInputFormat'
import type { SignupLocation } from '@/lib/auth/registration/signupLocation'
import type { ProfessionType } from '@prisma/client'

type SignupRole = 'CLIENT' | 'PRO'

type SocialField =
  | 'role'
  | 'firstName'
  | 'lastName'
  | 'zip'
  | 'state'
  | 'location'
  | 'radius'
  | 'licenseNumber'
  | 'phone'
  | 'smsConsent'
  | 'tos'

const FIELD_IDS: Record<SocialField, string> = {
  role: 'social-role',
  firstName: 'social-first-name',
  lastName: 'social-last-name',
  zip: 'social-zip',
  state: 'social-license-state',
  location: 'social-location',
  radius: 'social-radius',
  licenseNumber: 'social-license-number',
  phone: 'social-phone',
  smsConsent: 'social-sms-consent',
  tos: 'social-tos',
}

const ROLE_STEP: readonly SocialField[] = ['role']

// Step 0 is the same question for everyone; what follows depends on the answer.
const STEPS: Record<SignupRole, ReadonlyArray<readonly SocialField[]>> = {
  CLIENT: [
    ROLE_STEP,
    ['firstName', 'lastName', 'zip', 'phone', 'smsConsent', 'tos'],
  ],
  PRO: [
    ROLE_STEP,
    ['state', 'location', 'radius', 'licenseNumber'],
    ['firstName', 'lastName', 'phone', 'smsConsent', 'tos'],
  ],
}

const STEP_LABELS: Record<SignupRole, readonly string[]> = {
  CLIENT: ['You', 'Your details'],
  PRO: ['You', 'Your work', 'About you'],
}

const PROVIDER_NAMES: Record<SocialProvider, string> = {
  google: 'Google',
  apple: 'Apple',
}

export default function SocialCompleteClient() {
  const router = useRouter()
  const sp = useSearchParams()
  const { brand } = useBrand()

  const { ti, from, nextFromQuery, intent, inviteToken, via, vsig } = useMemo(
    () => readSignupForwardedParams(sp),
    [sp],
  )

  // Read once, on mount: sessionStorage does not exist during the server
  // render, and `hydrated` keeps the "start again" screen from flashing before
  // a perfectly good ticket has been looked for.
  const [hydrated, setHydrated] = useState(false)
  const [ticket, setTicket] = useState<SocialSignupHandoff | null>(null)

  const [role, setRole] = useState<SignupRole | null>(null)
  const [step, setStep] = useState(0)

  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [tosAccepted, setTosAccepted] = useState(false)
  const [transactionalSmsConsent, setTransactionalSmsConsent] = useState(false)

  const [businessName, setBusinessName] = useState('')
  const [handle, setHandle] = useState('')
  const [professionType, setProfessionType] =
    useState<ProfessionType>('COSMETOLOGIST')
  const [licenseState, setLicenseState] = useState('')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [licenseExpiry, setLicenseExpiry] = useState('')

  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<SocialField, string>>
  >({})
  const [loading, setLoading] = useState(false)
  // Set when the server took the ticket and answered with a claim link: the
  // account was NOT created, and the only way forward is that link — so the
  // form is replaced rather than left looking retryable.
  const [claimable, setClaimable] = useState<{
    maskedDestination: string | null
    sent: boolean
  } | null>(null)

  useEffect(() => {
    const stashed = readSocialSignup()
    setTicket(stashed)
    if (stashed) {
      setFirstName(stashed.prefill.firstName ?? '') // pii-plaintext-read-ok: the provider's own prefill, out of this tab's sessionStorage — not a DB read
      setLastName(stashed.prefill.lastName ?? '') // pii-plaintext-read-ok: the provider's own prefill, out of this tab's sessionStorage — not a DB read
    }
    setHydrated(true)
  }, [])

  function setFieldError(field: SocialField, message: string | null) {
    setFieldErrors((prev) => {
      const next = { ...prev }
      if (message) next[field] = message
      else delete next[field]
      return next
    })
  }

  const zipField = useClientZip()
  const workLocation = useWorkLocation({
    onLocationError: (message) => setFieldError('location', message),
  })

  const steps = STEPS[role ?? 'CLIENT']
  const stepLabels = STEP_LABELS[role ?? 'CLIENT']
  const isLastStep = step === steps.length - 1
  const fieldOrder = useMemo(() => steps.flat(), [steps])

  const needsLicense = proNeedsLicense(professionType, licenseState)

  const loginHref = useMemo(
    () =>
      buildLoginHref({
        role: role ?? 'CLIENT',
        ti,
        from,
        next: nextFromQuery,
        intent,
        inviteToken,
        via,
        vsig,
        email: ticket?.prefill.email ?? null,
        phone: null,
      }),
    [role, ti, from, nextFromQuery, intent, inviteToken, via, vsig, ticket],
  )

  function stepOfField(field: SocialField): number {
    const index = steps.findIndex((fields) => fields.includes(field))
    return index === -1 ? 0 : index
  }

  function surfaceErrors(errors: Partial<Record<SocialField, string>>): boolean {
    setFieldErrors(errors)

    const firstInvalid = fieldOrder.find((field) => errors[field])
    if (!firstInvalid) return false

    const targetStep = stepOfField(firstInvalid)
    if (targetStep !== step) setStep(targetStep)

    // Deferred so the field exists when a step change re-renders the form.
    window.setTimeout(() => focusFieldById(FIELD_IDS[firstInvalid]), 0)
    return true
  }

  /**
   * The ZIP is confirmed by a network round trip, so collecting errors is async
   * — and the confirmed value it produces is the one the payload needs, which
   * is why it comes back alongside the errors rather than being re-read from
   * state that has not re-rendered yet.
   */
  async function collectErrors(fields: readonly SocialField[]): Promise<{
    errors: Partial<Record<SocialField, string>>
    confirmedZip: ConfirmedZip | null
  }> {
    const errors: Partial<Record<SocialField, string>> = {}
    let confirmedZip: ConfirmedZip | null = zipField.confirmed

    if (fields.includes('zip')) {
      const result = await zipField.confirmIfValid()
      confirmedZip = result.confirmed
      if (!confirmedZip) {
        errors.zip = result.errorMessage ?? 'Please confirm your ZIP code.'
      }
    }

    for (const field of fields) {
      switch (field) {
        case 'role':
          if (!role) {
            errors.role = 'Please choose whether you’re a client or a pro.'
          }
          break
        case 'firstName':
          if (!firstName.trim()) errors.firstName = 'First name is required.'
          break
        case 'lastName':
          if (!lastName.trim()) errors.lastName = 'Last name is required.'
          break
        case 'state':
          if (!licenseState) errors.state = 'Please select your state.'
          break
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
        case 'licenseNumber':
          if (needsLicense && !licenseNumber.trim()) {
            errors.licenseNumber = licenseNumberRequiredMessage(
              professionType,
              licenseState,
            )
          }
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
        case 'tos':
          if (!tosAccepted) {
            errors.tos = 'Please accept the Terms and Privacy Policy.'
          }
          break
        case 'zip':
          // Handled above — it is the one field whose check is async.
          break
      }
    }

    return { errors, confirmedZip }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading || !ticket) return
    setError(null)

    const fields = isLastStep ? fieldOrder : (steps[step] ?? [])
    const { errors, confirmedZip } = await collectErrors(fields)
    if (surfaceErrors(errors)) return

    if (!isLastStep) {
      setStep(step + 1)
      return
    }

    // Unreachable when validation passed; narrows the payload below.
    const signupLocation: SignupLocation | null =
      role === 'PRO'
        ? workLocation.toSignupLocation()
        : confirmedZip
          ? clientZipToSignupLocation(confirmedZip)
          : null
    if (!role || !signupLocation) return

    setLoading(true)
    try {
      const res = await fetch('/api/v1/auth/social/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({
          signupTicket: ticket.signupTicket,
          role,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          phone: compactPhoneInputForSubmit(phone),
          tosAccepted: true,
          transactionalSmsConsent,
          signupLocation,
          tapIntentId: ti ?? undefined,
          next: nextFromQuery ?? undefined,
          intent: intent ?? undefined,
          inviteToken: inviteToken ?? undefined,
          via: via ?? undefined,
          vsig: vsig ?? undefined,
          ...(role === 'PRO'
            ? {
                professionType,
                businessName: businessName.trim() || undefined,
                handle: handle.trim()
                  ? sanitizeHandleInput(handle.trim())
                  : undefined,
                licenseState: licenseState || undefined,
                licenseNumber: needsLicense
                  ? licenseNumber.trim().toUpperCase()
                  : undefined,
                licenseExpiry:
                  needsLicense && licenseExpiry ? licenseExpiry : undefined,
                mobileRadiusMiles:
                  workLocation.mode === 'MOBILE'
                    ? Number(workLocation.radiusMiles)
                    : undefined,
              }
            : {}),
        }),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        const code = readStringField(data, 'code')

        // The two answers that mean this ticket is GONE. Everything else — a
        // rejected handle, a bad phone, a rate limit — leaves the form usable,
        // and if the ticket did in fact burn, the retry comes back as
        // INVALID_TICKET and lands here. That is the rule rather than a copy of
        // the route's refusal list, which would go stale the first time the
        // route grew a new one.
        if (code === 'INVALID_TICKET') {
          clearSocialSignup()
          setTicket(null)
          return
        }
        if (code === 'CLAIMABLE_HISTORY') {
          clearSocialSignup()
          setClaimable({
            maskedDestination: readStringField(data, 'maskedDestination'),
            sent: readBooleanField(data, 'claimLinkSent'),
          })
          return
        }

        setError(readErrorMessage(data) ?? 'Signup failed.')
        return
      }

      clearSocialSignup()
      router.refresh()

      const responseNextUrl = sanitizeNextUrl(readStringField(data, 'nextUrl'))
      const nextUrl = responseNextUrl ?? nextFromQuery

      hardNavigate(
        buildVerifyPhoneUrl({
          nextUrl,
          emailVerificationSent: readVerificationSendState(
            data,
            'emailVerificationSent',
          ),
          phoneVerificationSent: readVerificationSendState(
            data,
            'phoneVerificationSent',
          ),
        }),
      )
    } catch (err: unknown) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Signup failed.')
    } finally {
      setLoading(false)
    }
  }

  if (!hydrated) {
    return (
      <AuthShell title="Finishing sign-in" subtitle="One moment…">
        <div className="text-sm text-textSecondary">Checking your sign-in…</div>
      </AuthShell>
    )
  }

  if (claimable) {
    return (
      <AuthShell
        title="You already have history here"
        subtitle="Finish setting up your account from the secure link."
      >
        <div className="grid gap-4">
          {claimable.sent ? (
            <AuthNotice tone="success" className="px-4 py-3 font-normal">
              <div className="font-black">Check your email or text</div>
              <div className="mt-1 text-textSecondary">
                We found existing history for this contact and sent a secure
                link
                {claimable.maskedDestination ? (
                  <>
                    {' '}
                    to{' '}
                    <span className="font-black text-textPrimary">
                      {claimable.maskedDestination}
                    </span>
                  </>
                ) : null}
                . Open it to finish setting up your account and keep your
                booking history together.
              </div>
            </AuthNotice>
          ) : (
            <AuthNotice
              tone="warn"
              className="px-4 py-3 font-normal text-textPrimary"
            >
              <div className="font-black">You already have history here</div>
              <div className="mt-1 text-textSecondary">
                We found existing history for this contact, but couldn’t send a
                new secure link just now. Check your messages for a link we sent
                earlier, or try again in about an hour.
              </div>
            </AuthNotice>
          )}

          <SecondaryLinkButton href={loginHref}>
            Back to sign in
          </SecondaryLinkButton>
        </div>
      </AuthShell>
    )
  }

  if (!ticket) {
    return (
      <AuthShell
        title="That sign-in has expired"
        subtitle="Nothing was created — start again and it will only take a moment."
      >
        <div className="grid gap-4">
          <AuthNotice tone="warn">
            Your sign-in didn’t finish in time. Tap Google or Apple again on the
            sign-in screen to pick up where you left off.
          </AuthNotice>
          <SecondaryLinkButton href={loginHref}>
            Back to sign in
          </SecondaryLinkButton>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Finish creating your account"
      subtitle={`${PROVIDER_NAMES[ticket.provider]} confirmed your email. We just need a few things ${brand.displayName} can’t ask them for.`}
    >
      <form onSubmit={handleSubmit} className="grid gap-5" noValidate>
        <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 px-3 py-2 text-xs text-textSecondary">
          <span className="font-black text-textPrimary">Signing up as</span>{' '}
          <span className="font-black text-textPrimary">
            {ticket.prefill.email /* pii-plaintext-read-ok: showing a person the address their own provider just vouched for */}
          </span>
          <div className="mt-1">
            Verified by {PROVIDER_NAMES[ticket.provider]} — no password needed.
          </div>
        </div>

        {intent === 'CLAIM_INVITE' ? (
          <div className="rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 px-3 py-2 text-xs text-textSecondary">
            <span className="font-black text-textPrimary">Claim invite:</span>{' '}
            Your account will return to the secure claim link after phone
            verification.
          </div>
        ) : null}

        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-black tracking-wide text-textSecondary">
              Step {step + 1} of {steps.length}
            </span>
            <span className="text-xs font-black text-textPrimary">
              {stepLabels[step]}
            </span>
          </div>
          <div className="flex gap-1.5" aria-hidden="true">
            {stepLabels.map((label, index) => (
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

        {/* The role group is focusable on purpose: surfaceErrors() focuses the
            first invalid field by id, and a plain div silently ignores
            .focus(), so the one field that is a CHOICE rather than an input
            would be the one field that never got focused. */}
        {step === 0 ? (
          <div
            className="grid gap-2 focus:outline-none"
            id={FIELD_IDS.role}
            tabIndex={-1}
            role="group"
            aria-label="Client or pro"
            {...fieldErrorDescribedBy(FIELD_IDS.role, fieldErrors.role)}
          >
            <FieldLabel>What are you here to do?</FieldLabel>
            <div className="grid gap-2">
              <button
                type="button"
                onClick={() => {
                  setRole('PRO')
                  setFieldError('role', null)
                  setError(null)
                }}
                className={cn(
                  'rounded-card border px-4 py-3 text-left transition',
                  role === 'PRO'
                    ? 'border-accentPrimary/35 bg-accentPrimary/14'
                    : 'border-surfaceGlass/14 bg-bgPrimary/25 hover:border-surfaceGlass/20',
                )}
              >
                <div className="text-sm font-black text-textPrimary">
                  I’m a Pro — offer services
                </div>
                <div className="text-xs text-textSecondary">
                  Take bookings, run your calendar, get paid.
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setRole('CLIENT')
                  setFieldError('role', null)
                  setError(null)
                }}
                className={cn(
                  'rounded-card border px-4 py-3 text-left transition',
                  role === 'CLIENT'
                    ? 'border-accentPrimary/35 bg-accentPrimary/14'
                    : 'border-surfaceGlass/14 bg-bgPrimary/25 hover:border-surfaceGlass/20',
                )}
              >
                <div className="text-sm font-black text-textPrimary">
                  I’m a Client — book services
                </div>
                <div className="text-xs text-textSecondary">
                  Find pros, book fast, keep your history together.
                </div>
              </button>
            </div>
            <FieldErrorText
              id={`${FIELD_IDS.role}-error`}
              message={fieldErrors.role}
            />
          </div>
        ) : null}

        {role === 'PRO' && step === 1 ? (
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

        {role !== null && isLastStep ? (
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

              {role === 'CLIENT' ? (
                <ClientZipField
                  id={FIELD_IDS.zip}
                  controller={zipField}
                  error={fieldErrors.zip}
                  onErrorChange={(message) => setFieldError('zip', message)}
                  className="grid gap-1.5 sm:col-span-2"
                />
              ) : null}
            </div>

            {role === 'PRO' ? (
              <ProBrandingFields
                businessName={businessName}
                onBusinessNameChange={setBusinessName}
                handle={handle}
                onHandleChange={setHandle}
              />
            ) : null}

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
          <PrimaryButton loading={loading}>
            {!isLastStep
              ? 'Continue'
              : loading
                ? 'Creating…'
                : 'Create my account'}
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

          <SecondaryLinkButton href={loginHref}>
            I already have an account
          </SecondaryLinkButton>
        </div>
      </form>
    </AuthShell>
  )
}

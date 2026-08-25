// app/(auth)/_components/signup/SignupClientClient.tsx
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
import SocialSignIn from '../social/SocialSignIn'
import {
  safeJsonRecord,
  readBooleanField,
  readErrorMessage,
  readStringField,
} from '@/lib/http'
import { hardNavigate } from '@/lib/clientNavigation'
import { getTurnstileToken } from '@/lib/turnstileClient'
import {
  buildVerifyPhoneUrl,
  readVerificationSendState,
} from './buildVerifyPhoneUrl'
import ClientZipField from './location/ClientZipField'
import { clientZipToSignupLocation, useClientZip } from './location/useClientZip'
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
    via,
    vsig,
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
        via,
        vsig,
        email: emailPrefill || null,
        phone: phonePrefill || null,
      }),
    [ti, from, nextFromQuery, intent, inviteToken, via, vsig, emailPrefill, phonePrefill],
  )

  const isClaimInviteFlow = intent === 'CLAIM_INVITE'

  const [firstName, setFirstName] = useState(nameParts.firstName)
  const [lastName, setLastName] = useState(nameParts.lastName)

  const zipField = useClientZip()

  const [phone, setPhone] = useState(() => formatPhoneInputValue(phonePrefill))
  const [email, setEmail] = useState(emailPrefill)
  const [password, setPassword] = useState('')
  const [tosAccepted, setTosAccepted] = useState(false)
  const [transactionalSmsConsent, setTransactionalSmsConsent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set alongside `error` when signup collided with an existing account for the
  // typed contact — bridges the dead end with a log-in link carrying that
  // contact as a prefill instead of leaving the user stuck on the error.
  const [accountExistsLoginHref, setAccountExistsLoginHref] = useState<
    string | null
  >(null)
  const [claimableInfo, setClaimableInfo] = useState<{
    maskedDestination: string | null
    /** Whether the server actually queued a claim link for delivery. */
    sent: boolean
  } | null>(null)
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)
    setAccountExistsLoginHref(null)
    setClaimableInfo(null)

    const errors: Partial<Record<ClientField, string>> = {}

    if (!firstName.trim()) errors.firstName = 'First name is required.'
    if (!lastName.trim()) errors.lastName = 'Last name is required.'

    const zipResult = await zipField.confirmIfValid()
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
          via: via ?? undefined,
          vsig: vsig ?? undefined,
          signupLocation: clientZipToSignupLocation(confirmedZip),
        }),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        // Cold self-serve claim: the contact matches existing (pro-created)
        // history, so the server tried to send a claim link to the on-file
        // contact instead of creating a duplicate account. `claimLinkSent`
        // says whether a link actually went out — the banner must never
        // promise a message the server didn't queue.
        if (readStringField(data, 'code') === 'CLAIMABLE_HISTORY') {
          setClaimableInfo({
            maskedDestination: readStringField(data, 'maskedDestination'),
            sent: readBooleanField(data, 'claimLinkSent'),
          })
          return
        }

        if (readStringField(data, 'code') === 'ACCOUNT_EXISTS') {
          setAccountExistsLoginHref(
            buildLoginHref({
              role: 'CLIENT',
              ti,
              from,
              next: nextFromQuery,
              intent,
              inviteToken,
              email: email.trim() || null,
              phone: compactPhoneInputForSubmit(phone) || null,
            }),
          )
        }

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

          <ClientZipField
            id={FIELD_IDS.zip}
            controller={zipField}
            error={fieldErrors.zip}
            onErrorChange={(message) => setFieldError('zip', message)}
            className="grid gap-1.5 sm:col-span-2"
          />
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

        {/* Outcome notices render directly above the button that produced
            them — never at the top of a long form the user has scrolled past. */}
        {claimableInfo ? (
          claimableInfo.sent ? (
            <AuthNotice tone="success" className="px-4 py-3 font-normal">
              <div className="font-black">Check your email or text</div>
              <div className="mt-1 text-textSecondary">
                We found existing history for this contact and sent a secure
                link
                {claimableInfo.maskedDestination ? (
                  <>
                    {' '}
                    to{' '}
                    <span className="font-black text-textPrimary">
                      {claimableInfo.maskedDestination}
                    </span>
                  </>
                ) : null}
                . Open it to finish setting up your account and keep your
                booking history together.
              </div>
            </AuthNotice>
          ) : (
            <AuthNotice tone="warn" className="px-4 py-3 font-normal text-textPrimary">
              <div className="font-black">You already have history here</div>
              <div className="mt-1 text-textSecondary">
                We found existing history for this contact, but couldn’t send a
                new secure link just now. Check your messages for a link we
                sent earlier, or try again in about an hour.
              </div>
            </AuthNotice>
          )
        ) : null}

        {error ? (
          <AuthNotice tone="danger">
            {error}
            {accountExistsLoginHref ? (
              <div className="mt-1.5 text-sm font-bold text-textPrimary">
                That account may already be yours —{' '}
                <Link
                  href={accountExistsLoginHref}
                  className="underline underline-offset-2"
                >
                  log in to continue
                </Link>
                .
              </div>
            ) : null}
          </AuthNotice>
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
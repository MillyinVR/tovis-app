// app/client/(gated)/settings/become-a-pro/BecomeProClient.tsx
//
// The form behind "Offer services" — the CTA that finally calls
// POST /api/v1/pro/upgrade, which has shipped dark since #987.
//
// It asks for LESS than pro signup does, and that is the whole point of the
// door. The person is already signed in and already verified, so their name,
// phone and consents carry over server-side (see the route's `identity` block).
// What is left is only what the app cannot know about a client: what they do,
// where they do it, what licenses them to do it, and what they trade under.
//
// Every field here is the SAME component the pro signup screen renders — the
// extraction #993 paid for. A second spelling of the licence card or the work
// location picker is not a cosmetic problem: those fields decide whether
// somebody may legally take bookings, and a fork is how one of the two screens
// quietly stops asking.
//
// ⚠️ The upgrade is IRREVERSIBLE and flips the account's home role to PRO
// (the route's own DECISION note explains why it must). So the confirm step is
// not decoration — it is the only place a person is told what is about to
// change about their account before it changes.

'use client'

import Link from 'next/link'
import { useState } from 'react'

import AuthNotice from '@/app/(auth)/_components/AuthNotice'
import PrimaryButton from '@/app/(auth)/_components/PrimaryButton'
import WorkLocationFields from '@/app/(auth)/_components/signup/location/WorkLocationFields'
import { useWorkLocation } from '@/app/(auth)/_components/signup/location/useWorkLocation'
import ProBrandingFields from '@/app/(auth)/_components/signup/pro/ProBrandingFields'
import {
  licenseNumberRequiredMessage,
  proNeedsLicense,
  ProLicenseCard,
  ProProfessionFields,
} from '@/app/(auth)/_components/signup/pro/ProCredentialFields'
import {
  FieldErrorText,
  fieldErrorDescribedBy,
  focusFieldById,
} from '@/app/(auth)/_components/signup/fieldErrors'
import { hardNavigate, sanitizeInternalPath } from '@/lib/clientNavigation'
import { sanitizeHandleInput } from '@/lib/handles'
import { readErrorMessage, readStringField, safeJsonRecord } from '@/lib/http'
import { cn } from '@/lib/utils'
import type { ProfessionType } from '@prisma/client'

type UpgradeField = 'state' | 'location' | 'radius' | 'licenseNumber' | 'confirm'

const FIELD_IDS: Record<UpgradeField, string> = {
  state: 'upgrade-license-state',
  location: 'upgrade-location',
  radius: 'upgrade-radius',
  licenseNumber: 'upgrade-license-number',
  confirm: 'upgrade-confirm',
}

/**
 * Field order for "jump to the first thing that is wrong". Mirrors the render
 * order below, so the person is never sent UP the page past a valid field.
 */
const FIELD_ORDER: readonly UpgradeField[] = [
  'state',
  'location',
  'radius',
  'licenseNumber',
  'confirm',
]

/**
 * Where the route sends an upgraded pro. Sanitized rather than trusted even
 * though it is our own route: it is a redirect target arriving over the wire,
 * and `/pro/calendar` is the destination the route documents.
 */
const PRO_HOME = '/pro/calendar'

export default function BecomeProClient() {
  const [professionType, setProfessionType] =
    useState<ProfessionType>('COSMETOLOGIST')
  const [licenseState, setLicenseState] = useState('')
  const [licenseNumber, setLicenseNumber] = useState('')
  const [licenseExpiry, setLicenseExpiry] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [handle, setHandle] = useState('')
  const [confirmed, setConfirmed] = useState(false)

  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<
    Partial<Record<UpgradeField, string>>
  >({})
  const [loading, setLoading] = useState(false)

  function setFieldError(field: UpgradeField, message: string | null) {
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

  const needsLicense = proNeedsLicense(professionType, licenseState)

  function collectErrors(): Partial<Record<UpgradeField, string>> {
    const errors: Partial<Record<UpgradeField, string>> = {}

    if (!licenseState) errors.state = 'Please select your state.'

    const locationMessage = workLocation.validateLocation()
    if (locationMessage) errors.location = locationMessage

    const radiusMessage = workLocation.validateRadius()
    if (radiusMessage) errors.radius = radiusMessage

    if (needsLicense && !licenseNumber.trim()) {
      errors.licenseNumber = licenseNumberRequiredMessage(
        professionType,
        licenseState,
      )
    }

    if (!confirmed) {
      errors.confirm =
        'Please confirm you understand your account becomes a pro account.'
    }

    return errors
  }

  function surfaceErrors(
    errors: Partial<Record<UpgradeField, string>>,
  ): boolean {
    setFieldErrors(errors)

    const firstInvalid = FIELD_ORDER.find((field) => errors[field])
    if (!firstInvalid) return false

    focusFieldById(FIELD_IDS[firstInvalid])
    return true
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (loading) return
    setError(null)

    if (surfaceErrors(collectErrors())) return

    // Unreachable once validateLocation() passed; narrows the payload.
    const signupLocation = workLocation.toSignupLocation()
    if (!signupLocation) return

    setLoading(true)
    try {
      const res = await fetch('/api/v1/pro/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        cache: 'no-store',
        body: JSON.stringify({
          professionType,
          businessName: businessName.trim() || undefined,
          handle: handle.trim() ? sanitizeHandleInput(handle.trim()) : undefined,
          licenseState,
          licenseNumber: needsLicense
            ? licenseNumber.trim().toUpperCase()
            : undefined,
          licenseExpiry: needsLicense && licenseExpiry ? licenseExpiry : undefined,
          mobileRadiusMiles:
            workLocation.mode === 'MOBILE'
              ? Number(workLocation.radiusMiles)
              : undefined,
          signupLocation,
        }),
      })

      const data = await safeJsonRecord(res)

      if (!res.ok) {
        // ALREADY_PRO is the one refusal the form cannot be retried out of —
        // the workspace exists, so the honest move is to stop offering to
        // create it. Every other refusal (a taken handle, a licence the state
        // rejected, a rate limit) leaves the form usable, which is why this is
        // a rule about THIS code rather than a copy of the route's list.
        if (readStringField(data, 'code') === 'ALREADY_PRO') {
          hardNavigate(PRO_HOME)
          return
        }

        setError(readErrorMessage(data) ?? 'Could not set up your pro account.')
        return
      }

      // A hard navigation, not router.push: the route re-mints the session
      // cookie with the PRO acting role, and only a fresh document request
      // makes the server components — including the shell that decides whether
      // this person may be in /pro at all — read it.
      hardNavigate(sanitizeInternalPath(readStringField(data, 'nextUrl')) ?? PRO_HOME)
    } catch (err: unknown) {
      console.error(err)
      setError(
        err instanceof Error ? err.message : 'Could not set up your pro account.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid gap-5" noValidate>
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
        errors={{ location: fieldErrors.location, radius: fieldErrors.radius }}
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

      <ProBrandingFields
        businessName={businessName}
        onBusinessNameChange={setBusinessName}
        handle={handle}
        onHandleChange={setHandle}
      />

      <label className="flex items-start gap-3 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 px-3 py-3 text-sm text-textSecondary">
        <input
          id={FIELD_IDS.confirm}
          type="checkbox"
          checked={confirmed}
          onChange={(e) => {
            setConfirmed(e.target.checked)
            setFieldError('confirm', null)
          }}
          className="mt-0.5 h-4 w-4 rounded border-surfaceGlass/20"
          {...fieldErrorDescribedBy(FIELD_IDS.confirm, fieldErrors.confirm)}
        />
        <span className="leading-5">
          I understand this account becomes a{' '}
          <span className="font-black text-textPrimary">pro account</span>. Your
          bookings, boards and chart stay exactly where they are — use the
          workspace switcher to come back to them at any time. This cannot be
          undone from the app.
          <FieldErrorText
            id={`${FIELD_IDS.confirm}-error`}
            message={fieldErrors.confirm}
          />
        </span>
      </label>

      {/*
        Directly above the control it reports on — the auth screens' placement
        rule (Tori, 2026-08-23), and this form borrows their fields, so it
        borrows the rule with them.
      */}
      {error ? <AuthNotice tone="danger">{error}</AuthNotice> : null}

      <div className="grid gap-2 pt-1">
        <PrimaryButton loading={loading}>
          {loading ? 'Setting up…' : 'Set up my pro account'}
        </PrimaryButton>

        <Link
          href="/client/settings"
          className={cn(
            'inline-flex w-full items-center justify-center rounded-full border px-4 py-2 text-sm font-black transition',
            'border-surfaceGlass/14 bg-bgPrimary/25 text-textPrimary',
            'hover:border-surfaceGlass/20 hover:bg-bgPrimary/30',
            'focus:outline-none focus:ring-2 focus:ring-accentPrimary/15',
          )}
        >
          Not now
        </Link>
      </div>
    </form>
  )
}

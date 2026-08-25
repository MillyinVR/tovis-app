// app/(auth)/_components/signup/pro/ProCredentialFields.tsx
//
// What a pro is, and what licenses them to do it.
//
// Two components rather than one, because the work-location block sits between
// them on the pro signup screen: `ProProfessionFields` asks the two questions
// whose ANSWERS decide whether a credential is needed at all, and
// `ProLicenseCard` renders the credential itself (nothing, when that pair does
// not require one). Callers compute `proNeedsLicense` from the same pair, so
// the two can never disagree about whether the card belongs.
//
// Shared because the social completion form asks the identical questions; it
// was a hand-copied ~150 lines away from being the second copy.
//
// The profession OPTIONS are not written here either — they come from
// lib/professions, which is also what names a profession on a public profile.
// The two had already drifted: this dropdown said "Hairstylist" while every
// customer-facing surface said "Hair stylist".

'use client'

import FieldLabel from '../../FieldLabel'
import HelpText from '../../HelpText'
import Input from '../../Input'
import Select from '../../Select'
import { FieldErrorText, fieldErrorDescribedBy } from '../fieldErrors'
import { PROFESSION_OPTIONS } from '@/lib/professions'
import { US_STATES, stateName } from '@/lib/usStates'
import {
  getLicenseRequirement,
  requiresLicense,
  supportsOnlineVerification,
} from '@/lib/licensing/licenseRequirement'
import type { ProfessionType } from '@prisma/client'


/** True only once BOTH halves are known and that pair requires a credential. */
export function proNeedsLicense(
  professionType: ProfessionType,
  licenseState: string,
): boolean {
  return Boolean(licenseState) && requiresLicense(professionType, licenseState)
}

/**
 * The refusal when the credential field is required and empty. It lives beside
 * the card because it has to use the SAME word the field's own label uses —
 * "registration" in a state that registers, "license" everywhere else — and the
 * two drifting apart is exactly what a shared home prevents.
 */
export function licenseNumberRequiredMessage(
  professionType: ProfessionType,
  licenseState: string,
): string {
  return getLicenseRequirement(professionType, licenseState) === 'REGISTERED'
    ? 'Registration number is required for this profession in your state.'
    : 'License number is required for this profession in your state.'
}

export function ProProfessionFields({
  professionType,
  onProfessionChange,
  licenseState,
  onLicenseStateChange,
  stateId,
  stateError,
}: {
  professionType: ProfessionType
  onProfessionChange: (next: ProfessionType) => void
  licenseState: string
  onLicenseStateChange: (next: string) => void
  stateId: string
  stateError: string | undefined
}) {
  const needsLicense = proNeedsLicense(professionType, licenseState)

  return (
    <>
      <div className="grid gap-2">
        <FieldLabel>Profession</FieldLabel>
        <Select
          value={professionType}
          onChange={(e) => {
            const next = PROFESSION_OPTIONS.find(
              (p) => p.value === e.target.value,
            )?.value
            if (next) onProfessionChange(next)
          }}
        >
          {PROFESSION_OPTIONS.map((p) => (
            <option key={p.value} value={p.value}>
              {p.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="grid gap-2">
        <label className="grid gap-1.5">
          <FieldLabel>State you’re licensed / operating in</FieldLabel>
          <Select
            id={stateId}
            value={licenseState}
            onChange={(e) => onLicenseStateChange(e.target.value)}
            {...fieldErrorDescribedBy(stateId, stateError)}
          >
            <option value="">Select your state…</option>
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </Select>
        </label>
        <FieldErrorText id={`${stateId}-error`} message={stateError} />
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
    </>
  )
}

/** The credential itself. Renders nothing when this pair does not need one. */
export function ProLicenseCard({
  professionType,
  licenseState,
  licenseNumber,
  onLicenseNumberChange,
  licenseExpiry,
  onLicenseExpiryChange,
  licenseNumberId,
  licenseNumberError,
}: {
  professionType: ProfessionType
  licenseState: string
  licenseNumber: string
  onLicenseNumberChange: (next: string) => void
  licenseExpiry: string
  onLicenseExpiryChange: (next: string) => void
  licenseNumberId: string
  licenseNumberError: string | undefined
}) {
  if (!proNeedsLicense(professionType, licenseState)) return null

  const licenseRequirement = getLicenseRequirement(professionType, licenseState)

  return (
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
          id={licenseNumberId}
          value={licenseNumber}
          onChange={(e) => onLicenseNumberChange(e.target.value)}
          placeholder="e.g. 123456"
          autoCapitalize="characters"
          {...fieldErrorDescribedBy(licenseNumberId, licenseNumberError)}
        />
        <FieldErrorText
          id={`${licenseNumberId}-error`}
          message={licenseNumberError}
        />
      </label>

      <label className="grid gap-1.5">
        <FieldLabel>Expiration date</FieldLabel>
        <Input
          type="date"
          value={licenseExpiry}
          onChange={(e) => onLicenseExpiryChange(e.target.value)}
        />
        <HelpText>
          Optional now — you’ll need it (plus a license photo) before an admin
          can approve you.
        </HelpText>
      </label>

      <div className="rounded-card border border-surfaceGlass/12 bg-bgPrimary/25 px-3 py-2 text-xs text-textSecondary">
        {supportsOnlineVerification(professionType, licenseState)
          ? 'We’ll try to verify your license automatically. If verification is unavailable, you’ll upload a license photo'
          : 'We’ll review your credential after signup. You’ll upload a photo'}
        <span className="font-black text-textPrimary"> after signup</span> on the
        Verification page of your pro dashboard for admin approval.
        <div className="mt-1">
          You can still set up services + your calendar immediately.
        </div>
      </div>
    </div>
  )
}

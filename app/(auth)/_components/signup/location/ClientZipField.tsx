// app/(auth)/_components/signup/location/ClientZipField.tsx
//
// The ZIP field a client signup shows: type it, leave the field, we confirm it
// and say where that is. Shared by the password signup and the social
// completion form so "Confirmed" means the same thing on both.

'use client'

import FieldLabel from '../../FieldLabel'
import HelpText from '../../HelpText'
import Input from '../../Input'
import { FieldErrorText, fieldErrorDescribedBy } from '../fieldErrors'
import { friendlyTimeZoneLabel } from '@/lib/timeZone'
import type { ClientZipController } from './useClientZip'

export default function ClientZipField({
  id,
  controller,
  error,
  onErrorChange,
  className,
}: {
  id: string
  controller: ClientZipController
  error: string | undefined
  /** Cleared on edit, set from the confirm attempt on blur. */
  onErrorChange: (message: string | null) => void
  className?: string
}) {
  const { zip, loading, confirmed } = controller

  return (
    <label className={className ?? 'grid gap-1.5'}>
      <div className="flex items-center justify-between gap-3">
        <FieldLabel>ZIP code</FieldLabel>
        {confirmed?.timeZoneId ? (
          <span className="text-[11px] font-black text-textSecondary/80">
            {friendlyTimeZoneLabel(confirmed.timeZoneId) ?? confirmed.timeZoneId}
          </span>
        ) : null}
      </div>

      <Input
        id={id}
        value={zip}
        onChange={(e) => {
          controller.change(e.target.value)
          onErrorChange(null)
        }}
        onBlur={() => {
          void controller
            .confirmIfValid(zip)
            .then((result) => onErrorChange(result.errorMessage))
        }}
        placeholder="e.g. 92024"
        inputMode="numeric"
        autoComplete="postal-code"
        {...fieldErrorDescribedBy(id, error)}
      />
      <FieldErrorText id={`${id}-error`} message={error} />

      <div className="flex items-center justify-between gap-3">
        {loading ? (
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
            onClick={() => controller.reset(zip)}
          >
            Change
          </button>
        </div>
      ) : null}
    </label>
  )
}

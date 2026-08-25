// app/(auth)/_components/signup/location/WorkLocationFields.tsx
//
// The three fields that together say where a pro works: salon-or-mobile, the
// address or base ZIP, and (mobile only) how far they travel. One component
// because the middle field's label, keyboard, confirm affordance and validity
// rule all change with the first, and the third only exists for one of them.

'use client'

import FieldLabel from '../../FieldLabel'
import HelpText from '../../HelpText'
import Input from '../../Input'
import { FieldErrorText, fieldErrorDescribedBy } from '../fieldErrors'
import { cn } from '@/lib/utils'
import { friendlyTimeZoneLabel } from '@/lib/timeZone'
import type { WorkLocationController, WorkLocationMode } from './useWorkLocation'

const MODES: ReadonlyArray<{ value: WorkLocationMode; label: string }> = [
  { value: 'SALON', label: 'In salon / suite' },
  { value: 'MOBILE', label: 'Mobile' },
]

export default function WorkLocationFields({
  controller,
  ids,
  errors,
  onErrorChange,
  onModeChange,
}: {
  controller: WorkLocationController
  ids: { location: string; radius: string }
  errors: { location?: string; radius?: string }
  onErrorChange: (field: 'location' | 'radius', message: string | null) => void
  /** Lets the host clear its own form-level notice when the mode flips. */
  onModeChange?: (mode: WorkLocationMode) => void
}) {
  const { mode, query, predictions, loading, confirmed } = controller

  return (
    <>
      <div className="grid gap-2">
        <FieldLabel>Where do you offer services?</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          {MODES.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                controller.setMode(option.value)
                onModeChange?.(option.value)
              }}
              className={cn(
                'rounded-full border px-3 py-2 text-xs font-black transition',
                mode === option.value
                  ? 'border-accentPrimary/35 bg-accentPrimary/14 text-textPrimary'
                  : 'border-surfaceGlass/14 bg-bgPrimary/25 text-textSecondary hover:text-textPrimary',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-1.5">
        <div className="flex items-center justify-between gap-3">
          <FieldLabel>{controller.label()}</FieldLabel>
          {confirmed?.timeZoneId ? (
            <span className="text-[11px] font-black text-textSecondary/80">
              {friendlyTimeZoneLabel(confirmed.timeZoneId) ??
                confirmed.timeZoneId}
            </span>
          ) : null}
        </div>

        <div className="relative">
          <Input
            id={ids.location}
            value={query}
            onChange={(e) => void controller.refreshPredictions(e.target.value)}
            placeholder={controller.placeholder()}
            autoComplete="off"
            inputMode={mode === 'MOBILE' ? 'numeric' : 'text'}
            {...fieldErrorDescribedBy(ids.location, errors.location)}
          />

          {mode === 'SALON' && predictions.length > 0 ? (
            <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-card border border-surfaceGlass/12 bg-bgPrimary/60 tovis-glass-soft">
              <div className="max-h-64 overflow-auto p-1">
                {predictions.map((p) => (
                  <button
                    key={p.placeId}
                    type="button"
                    onClick={() => void controller.pickPrediction(p)}
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
          {loading ? <HelpText>Confirming…</HelpText> : <span />}

          {controller.isConfirmed() ? (
            <span className="text-xs font-black text-accentPrimary">
              Confirmed
            </span>
          ) : mode === 'MOBILE' ? (
            <button
              type="button"
              onClick={() => void controller.confirmZip()}
              disabled={loading || !query.trim()}
              className={cn(
                'inline-flex items-center justify-center rounded-full border px-3 py-1 text-xs font-black transition',
                'border-surfaceGlass/14 bg-bgPrimary/25 text-textPrimary',
                'hover:border-surfaceGlass/20 hover:bg-bgPrimary/30',
                'focus:outline-none focus:ring-2 focus:ring-accentPrimary/15',
                (loading || !query.trim()) && 'cursor-not-allowed opacity-60',
              )}
            >
              Confirm ZIP
            </button>
          ) : (
            <HelpText>Pick your address from the dropdown to confirm.</HelpText>
          )}
        </div>

        <FieldErrorText
          id={`${ids.location}-error`}
          message={errors.location}
        />
      </div>

      {mode === 'MOBILE' ? (
        <label className="grid gap-1.5">
          <div className="flex items-center justify-between gap-3">
            <FieldLabel>Mobile radius (miles)</FieldLabel>
            <span className="text-xs font-black text-textSecondary/80">
              Required
            </span>
          </div>
          <Input
            id={ids.radius}
            value={controller.radiusMiles}
            onChange={(e) => {
              controller.setRadiusMiles(e.target.value)
              onErrorChange('radius', null)
            }}
            inputMode="numeric"
            placeholder="e.g. 15"
            required
            {...fieldErrorDescribedBy(ids.radius, errors.radius)}
          />
          <HelpText>How far you travel from your base ZIP.</HelpText>
          <FieldErrorText id={`${ids.radius}-error`} message={errors.radius} />
        </label>
      ) : null}
    </>
  )
}

// app/pro/services/ConsentRequirementPicker.tsx
'use client'

/**
 * K15: which consent form THIS service requires the client to have signed.
 *
 * 🔴 The copy has to be honest about what the requirement does, because what it
 * does is deliberately mild: it WARNS. A pro who reads "require" and expects the
 * platform to refuse the booking would discover otherwise at the worst possible
 * moment, so the hint says plainly that nothing is blocked (the card's "warn,
 * don't block, in v1").
 *
 * A `<select>` rather than the radio pills the swatch and prepay pickers use: a
 * pro can have many forms, and a growing pill row would push the price fields
 * off a phone. The empty option is a real choice ("No form needed"), not a
 * placeholder — clearing a requirement must be as easy as setting one.
 */

import { Select } from '@/app/_components/ui'

type FormOption = {
  formId: string
  title: string
  kindLabel: string
  version: number
}

export default function ConsentRequirementPicker(props: {
  /** The current requirement; `null` = none. */
  value: string | null
  onChange: (next: string | null) => void
  /** The pro's ACTIVE forms that have published text. */
  forms: readonly FormOption[]
  disabled?: boolean
  /** Unique per offering — several pickers share one page. */
  id: string
}) {
  const { value, onChange, forms, disabled = false, id } = props

  const selected = forms.find((form) => form.formId === value) ?? null

  // A requirement whose form is not in the list (retired since it was set)
  // still shows as SET — silently rendering "No form needed" over a live
  // requirement would misreport the pro's own configuration.
  const boundButUnlisted = value !== null && selected === null

  return (
    <div className="grid gap-2">
      <label
        htmlFor={id}
        className="text-[11px] font-black text-textSecondary"
      >
        Require a signed form
      </label>

      {forms.length === 0 ? (
        <div className="text-[11px] text-textSecondary/70">
          You have no consent forms with published text yet. Create one under
          Forms, then come back to require it here.
        </div>
      ) : (
        <Select
          id={id}
          surface="translucent"
          value={boundButUnlisted ? '' : (value ?? '')}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value || null)}
        >
          <option value="">No form needed</option>
          {forms.map((form) => (
            <option key={form.formId} value={form.formId}>
              {form.title} ({form.kindLabel}, v{form.version})
            </option>
          ))}
        </Select>
      )}

      {boundButUnlisted ? (
        <div className="text-[11px] font-semibold text-toneWarn">
          This service requires a form you have since retired. Reactivate it, or
          pick another — clients are still being marked as needing it.
        </div>
      ) : null}

      <div className="text-[11px] text-textSecondary/70">
        {selected ? (
          <>
            Appointments for this service are marked on your calendar and at
            session start until the client has signed “{selected.title}”.{' '}
            <strong className="font-black">
              Bookings are never blocked
            </strong>{' '}
            — you decide what to do about an unsigned form.
          </>
        ) : (
          <>Clients book this service without signing anything first.</>
        )}
      </div>
    </div>
  )
}

// app/pro/services/CalendarSwatchPicker.tsx
'use client'

import {
  CALENDAR_SWATCH_IDS,
  type CalendarSwatchId,
} from '@/lib/calendar/eventColor'
import { cn } from '@/lib/utils'

/**
 * K8: the pro picks their calendar colour for one service.
 *
 * 🔴 A fixed set of brand tokens, never a hex/eyedropper picker. Three reasons,
 * and only the first is a house rule:
 *   1. raw colours are forbidden here and NO static guard catches one,
 *   2. a free colour has one value for both themes, so a colour that reads in
 *      light mode vanishes in dark — the twelve tokens carry a tuned pair,
 *   3. the palette is contrast-checked against every calendar surface
 *      (lib/brand/defaults.test.ts); an arbitrary colour is not.
 *
 * The chips paint `rgb(var(--swatch-NN))` inline rather than through a CSS
 * class per id. Deliberate: adding a thirteenth swatch already means editing
 * five places, and a second per-id rule family would make it six for no gain.
 */

/**
 * ⚠️ The chips are numbered, not named ("Colour 4", not "Olive").
 *
 * The hue names exist only as comments beside the DEFAULT palette. A
 * white-label tenant can ship its own twelve triplets for the same twelve ids,
 * at which point a hard-coded "Olive" would be telling a screen-reader user
 * something false about a colour they cannot see. A number is true under every
 * palette. Naming them honestly would mean carrying labels in the brand token
 * set alongside the triplets — a white-label change, not a picker change.
 */
function swatchLabel(id: CalendarSwatchId): string {
  return `Colour ${Number(id)}`
}

export default function CalendarSwatchPicker(props: {
  /** The current selection; `null` = no service colour. */
  value: CalendarSwatchId | null
  onChange: (next: CalendarSwatchId | null) => void
  disabled?: boolean
  /** Unique per offering — several pickers share one page. */
  name: string
}) {
  const { value, onChange, disabled = false, name } = props

  const chipBase =
    'grid h-8 w-8 place-items-center rounded-full border transition peer-focus-visible:ring-2 peer-focus-visible:ring-accentPrimary/60 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-bgSecondary'

  return (
    // A real radio group: native inputs give arrow-key navigation, a single tab
    // stop and correct grouping for free — a div of buttons gives none of that
    // without a roving-tabindex implementation.
    <fieldset className="grid gap-2" disabled={disabled}>
      <legend className="text-[11px] font-black text-textSecondary">
        Calendar colour
      </legend>

      <div className="flex flex-wrap items-center gap-2">
        <label className="cursor-pointer">
          <input
            type="radio"
            name={name}
            className="peer sr-only"
            checked={value === null}
            onChange={() => onChange(null)}
          />

          <span
            className={cn(
              chipBase,
              'w-auto gap-1 px-3 text-[11px] font-black',
              value === null
                ? 'border-accentPrimary bg-accentPrimary/15 text-textPrimary'
                : 'border-white/10 bg-bgPrimary/60 text-textSecondary hover:border-white/20',
            )}
          >
            None
          </span>
        </label>

        {CALENDAR_SWATCH_IDS.map((id) => {
          const selected = value === id
          const label = swatchLabel(id)

          return (
            <label key={id} className="cursor-pointer" title={label}>
              <input
                type="radio"
                name={name}
                className="peer sr-only"
                checked={selected}
                onChange={() => onChange(id)}
                aria-label={label}
              />

              <span
                className={cn(
                  chipBase,
                  // The selected ring sits OUTSIDE the chip rather than being a
                  // tick drawn on it: the twelve swatches are all tuned to one
                  // luminance, so no single ink colour would read on all of
                  // them. The ring also survives colour-blindness, which a
                  // hue-only "selected" state does not.
                  selected
                    ? 'border-textPrimary ring-2 ring-textPrimary ring-offset-2 ring-offset-bgSecondary'
                    : 'border-white/20 hover:border-white/40',
                )}
                style={{ background: `rgb(var(--swatch-${id}))` }}
              >
                {/* Non-colour confirmation of the selection, for anyone who
                    cannot separate the ring from the chip. */}
                <span className="sr-only">{selected ? 'Selected' : ''}</span>
              </span>
            </label>
          )
        })}
      </div>

      <div className="text-[11px] text-textSecondary/70">
        Paints the side stripe on this service&rsquo;s appointments. The card
        colour still shows the booking&rsquo;s status. Choose None to leave it
        off.
      </div>
    </fieldset>
  )
}

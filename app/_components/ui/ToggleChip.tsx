// app/_components/ui/ToggleChip.tsx
//
// Canonical selectable chip — a pill the user turns on and off, as opposed to
// <Badge>, which is a label the user cannot press. Two screens had declared this
// separately (client settings' interest picker and the board-form's category
// picker) with byte-identical class strings, one of them already hoisted into a
// local `CHIP_BASE_CLASS` constant because it was being repeated even there.
//
// It is a <button aria-pressed>, not a checkbox: `aria-pressed` is what tells a
// screen reader this is a toggle, and it is the one part of a hand-rolled chip
// that is easy to leave out. Having it here means nobody has to remember.
import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

const BASE =
  'inline-flex min-h-9 items-center rounded-full border px-3 py-1.5 text-[12px] font-bold transition'

const STATES = {
  on: 'border-textPrimary/40 bg-bgPrimary text-textPrimary',
  off: 'border-textPrimary/10 bg-bgPrimary/60 text-textSecondary hover:border-textPrimary/20 hover:text-textPrimary',
} as const

export type ToggleChipStyleOptions = {
  selected?: boolean
  className?: string
}

/** Canonical toggle-chip class string, for callers that can't render the button. */
export function toggleChipClassName({
  selected = false,
  className,
}: ToggleChipStyleOptions = {}): string {
  return cn(BASE, selected ? STATES.on : STATES.off, className)
}

export type ToggleChipProps = ToggleChipStyleOptions &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'aria-pressed'>

/** Canonical selectable chip. Announces its state via `aria-pressed`. */
export default function ToggleChip({
  selected = false,
  className,
  type = 'button',
  ...rest
}: ToggleChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={toggleChipClassName({ selected, className })}
      {...rest}
    />
  )
}

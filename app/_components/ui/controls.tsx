// app/_components/ui/controls.tsx
//
// Canonical text-entry controls: <TextInput>, <Select>, <Textarea>. They share
// ONE class string (`controlClassName`) because an input and a select that sit in
// the same form must not drift apart — which is exactly what had happened. Two
// styles were in the tree:
//
//   admin/permissions + admin/categories  rounded-card · border-surfaceGlass/12 ·
//                                         bg-bgPrimary · focus ring in accent
//   admin/services ×3                     rounded-xl   · border-surfaceGlass/15 ·
//                                         bg-bgPrimary/40 · focus:border-surfaceGlass/30
//
// This converges on the services shape (the majority, and 12px suits a dense
// admin table better than the 18px card radius) and keeps the accent focus ring
// from the permissions pair — `focus:border-surfaceGlass/30` alone is a very weak
// focus indicator, and the ring is the accessible half of that pair.
//
// `surface` exists because a SECOND coherent style turned out to be in the tree,
// and flattening it onto the dense one would have been a silent restyle of every
// auth screen. The auth forms and client settings share a softer field — card
// radius, raised-surface fill, a hover tint — and they had already drifted apart
// from each other while doing it (`border-surfaceGlass/10` in auth vs
// `border-textPrimary/10` in client settings, the same accent focus written once
// as a token utility and once long-hand as `rgb(var(--accent-primary)/0.35)`).
// One name for the style, two surfaces, no third copy.
//
// All three take a `ref` as an ordinary prop (React 19), so callers that need one
// no longer have to reach for forwardRef.
import type {
  InputHTMLAttributes,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

import { cn } from '@/lib/utils'

/**
 * `dense` is the admin/table field this file shipped with. `soft` is the
 * card-radius field the auth and client-settings forms use — a lighter border on
 * the raised surface, with a hover tint, for a form that is the whole page rather
 * than a cell in a dense table.
 */
export type ControlSurface = 'dense' | 'soft'

export type ControlStyleOptions = {
  surface?: ControlSurface
  className?: string
}

// Shared by both surfaces: the box, the type scale, and the states every control
// owes a user regardless of which surface it is painted on.
//
// No `focus:ring-*` here, and that is deliberate. These three elements are
// <input>/<select>/<textarea>, which match `:focus-visible` on EVERY focus —
// mouse included, per the spec's carve-out for text entry — so the unlayered
// global `:focus-visible` rule in globals.css always wins the box-shadow and a
// ring utility on this surface can never paint. Measured on a real auth field:
// focused box-shadow is the global `0 0 0 2px bg, 0 0 0 4px accent/.5`, with or
// without `focus:ring-2`. `focus:border-*` DOES paint (the global rule sets no
// border-color), so it stays.
const BASE =
  'w-full border px-3 py-2 text-sm text-textPrimary placeholder:text-textSecondary/70 outline-none disabled:cursor-not-allowed disabled:opacity-60'

const SURFACES: Record<ControlSurface, string> = {
  dense:
    'rounded-xl border-surfaceGlass/15 bg-bgPrimary/40 focus:border-accentPrimary/50',
  // `transition` rides with `soft` only — the dense field never had one, and
  // adding it here would have been an unrequested change to every admin form.
  soft: 'rounded-card border-surfaceGlass/10 bg-bgSecondary/35 transition hover:border-surfaceGlass/16 focus:border-accentPrimary/35',
}

/** The one control surface. Brand tokens only — no raw colors. */
export function controlClassName({
  surface = 'dense',
  className,
}: ControlStyleOptions = {}): string {
  return cn(BASE, SURFACES[surface], className)
}

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  surface?: ControlSurface
  ref?: Ref<HTMLInputElement>
}

/** Canonical single-line text input. */
export function TextInput({ surface, className, ...rest }: TextInputProps) {
  return <input className={controlClassName({ surface, className })} {...rest} />
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  surface?: ControlSurface
  ref?: Ref<HTMLSelectElement>
}

/** Canonical <select>. */
export function Select({ surface, className, ...rest }: SelectProps) {
  return <select className={controlClassName({ surface, className })} {...rest} />
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  surface?: ControlSurface
  ref?: Ref<HTMLTextAreaElement>
}

/** Canonical multi-line text control. */
export function Textarea({ surface, className, ...rest }: TextareaProps) {
  return (
    <textarea className={controlClassName({ surface, className })} {...rest} />
  )
}

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
//
// A THIRD turned up the same way: the pro forms. `w-full rounded-xl border
// border-white/10 bg-bgPrimary px-3 py-3 text-[13px] …` is written out by hand
// **20 times across 9 files** under `app/pro`, and it is a real style rather than
// drift: a solid (not translucent) fill and a roomier 12px vertical padding, for a
// modal form on top of the page rather than a cell in a table. Flattening it onto
// `dense` would have taken 4px of height and 1px of type off every pro field.
// One name for the style, three surfaces, no fourth copy.
//
// ⚠️ 20 was the number of written COPIES, not of controls. Seven were hoisted
// `const field = …` strings shared across many call sites. All are now on this
// surface: #913 took 11 controls, and the remaining 9 copies came over here as
// 44 — NewBookingForm 23, settingsClient 9, ServicePicker 8, NewMediaPostForm 2,
// OpenSlotPicker 1, ClientsList 1.
//
// ⚠️ …and 44 is a number that took three attempts, so distrust the next one too.
// Grepping `className={<the constant>}` finds 40 of the 44. The four it misses
// are the two ServicePicker selects that build the string inside an array
// `.join()`, the textarea that interpolates it in a template literal, and the
// site that hands it to a CHILD component as a `fieldClassName` prop
// (BookingOverridePromptCard's reason box — a control in another file
// entirely). A tag scanner written to catch those four then dropped a fifth,
// because an apostrophe inside a `//` comment in the attribute list opened a
// phantom string and swallowed the rest of the tag.
//
// Two neighbouring families are deliberately NOT on `solid`, because they differ
// by FILL rather than by drift, and folding them in would be a restyle:
//   · `bg-bgPrimary/70` — ConsentRequirementPicker, OfferingManager (6),
//     client ConsentSignCard, supportForm. A translucent field; `solid` is solid
//     by definition and by name.
//   · `bg-bgSecondary`  — NewMediaPostForm's three lower controls, which sit on a
//     raised panel inside the very form whose upper controls are `bg-bgPrimary`.
// Both are recorded in the cleanup register; neither is a fork of this surface.
//
// The copies disagreed on exactly one thing — the placeholder alpha — and that
// disagreement is now settled. `solid` shipped `placeholder:text-textSecondary`
// (full opacity) because #913 derived it from the two public-profile modals it
// migrated first. The rest of the surface said otherwise: of the 44 controls
// taken since, 19 carry a placeholder and 18 of those wrote `/70` — which is
// also what BASE says. So `solid` no longer overrides the placeholder at all, and
// BASE's `/70` is the pro field's alpha. Decided with Tori rather than inherited
// from whichever file happened to be migrated first; the 12 controls that did
// render full opacity (#913's 11, plus NewMediaPostForm's caption) moved to `/70`
// in the same PR, and nothing else about them changed.
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
 * than a cell in a dense table. `solid` is the pro forms' field: the dense box at
 * a roomier height, filled solid so it reads as a control sitting on top of a
 * modal rather than a tint let through it.
 */
export type ControlSurface = 'dense' | 'soft' | 'solid'

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
  // Overrides BASE's padding and type scale, because those two are what the pro
  // field differs by — and NOT the placeholder, which is BASE's `/70` (see the
  // header note). No `focus:border-*`: the pro fields
  // never had one, and the global unlayered `:focus-visible` ring is what has
  // always indicated focus here — measured on this very surface, the focused
  // box-shadow is identical with and without the `focus:ring-2` the copies wrote,
  // so that ring was dead and a focus border would be a new restyle. The border
  // tint is the token, not the copies' `white/10`: in dark that is
  // rgba(255,255,255,.1) → rgba(242,239,231,.1), imperceptible; in light it is
  // rgba(255,255,255,.1) → rgba(10,20,19,.1), i.e. a border that was invisible
  // over a near-white page becomes a hairline.
  solid: 'rounded-xl border-surfaceGlass/10 bg-bgPrimary py-3 text-[13px]',
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

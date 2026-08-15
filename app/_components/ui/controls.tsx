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
// All three take a `ref` as an ordinary prop (React 19), so callers that need one
// no longer have to reach for forwardRef.
import type {
  InputHTMLAttributes,
  Ref,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react'

import { cn } from '@/lib/utils'

/** The one control surface. Brand tokens only — no raw colors. */
export function controlClassName(className?: string): string {
  return cn(
    'w-full rounded-xl border border-surfaceGlass/15 bg-bgPrimary/40 px-3 py-2 text-sm text-textPrimary',
    'placeholder:text-textSecondary/70 outline-none',
    'focus:border-accentPrimary/50 focus:ring-2 focus:ring-accentPrimary/20',
    'disabled:cursor-not-allowed disabled:opacity-60',
    className,
  )
}

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  ref?: Ref<HTMLInputElement>
}

/** Canonical single-line text input. */
export function TextInput({ className, ...rest }: TextInputProps) {
  return <input className={controlClassName(className)} {...rest} />
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  ref?: Ref<HTMLSelectElement>
}

/** Canonical <select>. */
export function Select({ className, ...rest }: SelectProps) {
  return <select className={controlClassName(className)} {...rest} />
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  ref?: Ref<HTMLTextAreaElement>
}

/** Canonical multi-line text control. */
export function Textarea({ className, ...rest }: TextareaProps) {
  return <textarea className={controlClassName(className)} {...rest} />
}

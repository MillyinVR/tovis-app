// app/_components/ui/FieldLabel.tsx
//
// Canonical form-field label. Ten files declared their own one-line copy of this
// and they had already drifted: the admin catalogue screens used `font-extrabold`
// while permissions/categories used `font-black`, for a label that is meant to
// read identically everywhere. `font-black` wins here — it is what the denser
// admin forms shipped and it holds up better at 12px.
//
// Renders a <div> by default so it can sit above a control inside a <label>
// wrapper; pass `as="span"` when the parent is already a <label> and a block
// child would break its layout.
import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export type FieldLabelProps = HTMLAttributes<HTMLElement> & {
  as?: 'div' | 'span'
}

/** Canonical small-caps-weight label for a form control. */
export default function FieldLabel({
  as: Tag = 'div',
  className,
  ...rest
}: FieldLabelProps) {
  return (
    <Tag
      className={cn('text-xs font-black text-textSecondary', className)}
      {...rest}
    />
  )
}

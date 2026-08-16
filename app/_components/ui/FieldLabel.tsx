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
//
// `as="label"` exists because the primitive could not serve the most correct
// sites in the tree. Sweeping the hand-written form (`text-[12px] font-black
// text-textSecondary`) found 44 occurrences; of the 15 that are genuinely a
// label for a control, four — `app/pro/reminders` — are real
// `<label htmlFor=…>` elements, and a <div> cannot carry `htmlFor`. Migrating
// them onto a <div> would have traded an accessible name for a class string.
// So the union takes a third value rather than those four keeping their copy:
// when a fork resists, the primitive is missing a variant.
//
// The branch is explicit rather than a dynamic tag, and it earns its keep at the
// TYPE level only — at runtime `<Tag {...rest}>` with Tag='label' passes htmlFor
// through perfectly well, so deleting the branch keeps every test green. What it
// does not keep is `tsc`: destructuring the union first collapses the two prop
// bags, and the merged `rest` (which carries `htmlFor` and
// LabelHTMLAttributes' event handlers) is then not assignable to a <div> —
//   error TS2322: … 'ClipboardEventHandler<HTMLLabelElement>' is not assignable
//   to 'ClipboardEventHandler<HTMLDivElement>'
// Verified by deleting the branch and running `npm run typecheck`. So the guard
// against `htmlFor` reaching a <div> is the compiler, not a unit test — don't
// "simplify" this back on the strength of a green suite.
import type { HTMLAttributes, LabelHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

/**
 * The one converged label class. Pinned as a literal in
 * `tests/ui/uiPrimitives.test.tsx` — a test that compares the rendered class
 * against this constant would move both sides of its own comparison.
 */
const FIELD_LABEL_CLASS = 'text-xs font-black text-textSecondary'

export type FieldLabelProps =
  | ({ as?: 'div' | 'span' } & HTMLAttributes<HTMLElement>)
  | ({ as: 'label' } & LabelHTMLAttributes<HTMLLabelElement>)

/** Canonical small-caps-weight label for a form control. */
export default function FieldLabel(props: FieldLabelProps) {
  // Both arms are the same two lines; they are separate so that each one
  // destructures a NARROWED `props` and keeps its own prop bag intact.
  if (props.as === 'label') {
    const { as: Tag, className, ...rest } = props
    return <Tag className={cn(FIELD_LABEL_CLASS, className)} {...rest} />
  }

  const { as: Tag = 'div', className, ...rest } = props
  return <Tag className={cn(FIELD_LABEL_CLASS, className)} {...rest} />
}

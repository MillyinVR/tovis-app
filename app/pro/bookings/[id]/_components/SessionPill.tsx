// app/pro/bookings/[id]/_components/SessionPill.tsx
//
// The session flow's status chip. The session hub called it `Pill` and aftercare
// called it `StatusPill`; the two bodies are the same span with the same
// `brand-pro-session-pill` class, and aftercare's simply left out the `state`
// prop it never passed. Two names for one thing is the more expensive kind of
// duplicate, because it hides that they are the same thing.
//
// Same reasoning as [SessionCard](./SessionCard.tsx): this belongs to the
// `brand-pro-session-*` CSS design system, not to the UI kit's <Badge>. It
// de-duplicates within that system without converting it.
export type SessionPillProps = {
  label: string
  /** Where this step sits in the flow — drives the filled/■ treatment. */
  state?: 'active' | 'done'
  tone?: 'success' | 'pending' | 'danger'
}

export default function SessionPill({ label, state, tone }: SessionPillProps) {
  return (
    <span className="brand-pro-session-pill" data-state={state} data-tone={tone}>
      {label}
    </span>
  )
}

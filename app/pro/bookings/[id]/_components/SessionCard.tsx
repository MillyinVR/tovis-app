// app/pro/bookings/[id]/_components/SessionCard.tsx
//
// The session flow's surface. Four files — the session hub, aftercare, and the
// before/after photo steps — had each declared this component with BYTE-IDENTICAL
// bodies, down to the prop names and the `accent = false` default. Sixteen call
// sites, one component, four copies of it.
//
// It is deliberately NOT the UI kit's <Card>. The pro session screens are painted
// by a CSS design system (`brand-pro-session-*` in lib/brand/proSession.css) that
// styles by class and data-attribute rather than by utility, and converting that
// to the component kit is a real design decision, not a cleanup. This removes the
// duplication WITHIN that system and leaves the system alone.
import type { ReactNode } from 'react'

export type SessionCardProps = {
  children: ReactNode
  /** Raises the surface for the step the pro is currently on. */
  accent?: boolean
  /** Tints the surface for a terminal state. */
  tone?: 'success' | 'danger'
}

export default function SessionCard({
  children,
  accent = false,
  tone,
}: SessionCardProps) {
  return (
    <section
      className="brand-pro-session-card"
      data-accent={accent}
      data-tone={tone}
    >
      {children}
    </section>
  )
}

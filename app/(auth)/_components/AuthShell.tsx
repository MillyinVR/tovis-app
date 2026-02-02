// app/(auth)/_components/AuthShell.tsx
import type { ReactNode } from 'react'

export default function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: ReactNode
}) {
  return (
    <div className="relative min-h-[100svh] w-full overflow-hidden px-4 py-10 text-textPrimary">
      {/* Ambient background (token-only, no hex) */}
      <div
        aria-hidden="true"
        className={[
          'pointer-events-none absolute inset-0',
          // soft vignette + top glow + corner glow
          'bg-[radial-gradient(900px_circle_at_50%_-10%,rgb(var(--accent-primary)/0.18),transparent_55%),radial-gradient(700px_circle_at_0%_110%,rgb(var(--micro-accent)/0.10),transparent_55%),radial-gradient(900px_circle_at_100%_0%,rgb(var(--surface-glass)/0.06),transparent_60%)]',
        ].join(' ')}
      />

      {/* Subtle vignette overlay */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(1200px_circle_at_50%_30%,transparent_55%,rgb(var(--bg-primary)/0.85))]"
      />

      <div className="relative mx-auto w-full max-w-420px">
        {/* Wordmark header */}
        <div className="mb-7 flex items-center justify-center">
          <div className="grid place-items-center gap-1.5 text-center">
            <div className="text-[22px] font-black tracking-[0.24em] text-textPrimary">TOVIS</div>

            <div className="text-[11px] font-semibold tracking-wide text-textSecondary">
              A New Age of Self Care
            </div>

            {/* luxury micro-accent */}
            <div className="mt-1 flex items-center justify-center gap-2">
              <div className="h-px w-10 bg-surfaceGlass/15" />
              <div className="h-1 w-1 rounded-full bg-accentPrimary/60" />
              <div className="h-px w-10 bg-surfaceGlass/15" />
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="grid gap-1.5 text-center">
            <h1 className="text-[22px] font-extrabold tracking-tight">{title}</h1>
            {subtitle ? <p className="text-sm leading-relaxed text-textSecondary">{subtitle}</p> : null}
          </div>

          {/* Main surface */}
          <div className="relative overflow-hidden rounded-card border border-surfaceGlass/12 tovis-glass-soft">
            {/* top highlight edge (glass needs this) */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgb(var(--surface-glass)/0.20),transparent)]"
            />

            {/* gentle inner gradient for depth */}
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-[radial-gradient(700px_circle_at_30%_0%,rgb(var(--surface-glass)/0.06),transparent_55%)]"
            />

            <div className="relative p-5">{children}</div>
          </div>
        </div>
      </div>
    </div>
  )
}

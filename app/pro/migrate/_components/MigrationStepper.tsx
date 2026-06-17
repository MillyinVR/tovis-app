// app/pro/migrate/_components/MigrationStepper.tsx

import Link from 'next/link'

import { MIGRATION_STEPS } from '../_constants'
import type { MigrationStepKey } from '../_types'

type Props = {
  // omit on the entry screen → all steps render as not-started
  active?: MigrationStepKey
}

function statusFor(
  index: number,
  activeIndex: number,
): 'done' | 'active' | 'not-started' {
  if (index < activeIndex) return 'done'
  if (index === activeIndex) return 'active'
  return 'not-started'
}

export function MigrationStepper({ active }: Props) {
  const activeIndex = active
    ? MIGRATION_STEPS.findIndex((s) => s.key === active)
    : -1

  return (
    <nav
      aria-label="Migration progress"
      className="flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      {MIGRATION_STEPS.map((step, i) => {
        const status = statusFor(i, activeIndex)
        const isDone = status === 'done'
        const isActive = status === 'active'

        const dot = (
          <span
            className={[
              'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-mono',
              isDone
                ? 'bg-accentPrimary/15 text-accentPrimary ring-1 ring-accentPrimary/40'
                : isActive
                  ? 'bg-accentPrimary text-onAccent'
                  : 'bg-white/5 text-textMuted ring-1 ring-white/10',
            ].join(' ')}
            aria-hidden="true"
          >
            {isDone ? '✓' : i + 1}
          </span>
        )

        const label = (
          <span
            className={[
              'text-[13px]',
              isActive
                ? 'text-textPrimary'
                : isDone
                  ? 'text-accentPrimary'
                  : 'text-textMuted',
            ].join(' ')}
          >
            {step.label}
          </span>
        )

        const content = (
          <span
            className="inline-flex items-center gap-2"
            aria-current={isActive ? 'step' : undefined}
          >
            {dot}
            {label}
          </span>
        )

        return (
          <span key={step.key} className="inline-flex items-center gap-x-3">
            {isDone ? (
              <Link
                href={step.href}
                className="inline-flex items-center gap-2 rounded-full transition hover:opacity-80"
              >
                {content}
              </Link>
            ) : (
              content
            )}
            {i < MIGRATION_STEPS.length - 1 ? (
              <span className="h-px w-6 bg-white/10" aria-hidden="true" />
            ) : null}
          </span>
        )
      })}
    </nav>
  )
}

'use client'

// Non-blocking stepper for the aftercare summary. Regroups the existing
// aftercare cards into a short, ordered flow (Your visit → Checkout → What's
// next) without gating: every step is freely navigable via the progress chips
// or the Back/Continue buttons. Payment is never locked behind a prior step —
// a pro may collect in person, and a client may rebook before paying.

import { useState, type ReactNode } from 'react'

export type AftercareStep = {
  key: string
  /** Short chip label, e.g. "Your visit". */
  label: string
  content: ReactNode
}

function chipClass(active: boolean): string {
  return [
    'inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs font-black transition',
    active
      ? 'bg-accentPrimary text-bgPrimary shadow-sm'
      : 'bg-bgPrimary text-textPrimary hover:bg-surfaceGlass',
  ].join(' ')
}

export default function AftercareStepper(props: { steps: AftercareStep[] }) {
  const steps = props.steps
  const [activeIndex, setActiveIndex] = useState(0)

  if (steps.length === 0) return null

  // Guard against an out-of-range index if the visible steps ever shrink.
  const index = Math.min(activeIndex, steps.length - 1)
  const active = steps[index]!
  const isFirst = index === 0
  const isLast = index === steps.length - 1

  return (
    <div className="grid gap-4">
      <nav
        aria-label="Aftercare steps"
        className="flex flex-wrap items-center gap-2"
      >
        {steps.map((stepItem, stepIndex) => (
          <button
            key={stepItem.key}
            type="button"
            onClick={() => setActiveIndex(stepIndex)}
            aria-current={stepIndex === index ? 'step' : undefined}
            className={chipClass(stepIndex === index)}
          >
            <span
              className={[
                'inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-black',
                stepIndex === index
                  ? 'bg-bgPrimary/30 text-bgPrimary'
                  : 'bg-bgSecondary text-textSecondary',
              ].join(' ')}
            >
              {stepIndex + 1}
            </span>
            {stepItem.label}
          </button>
        ))}
      </nav>

      <div className="grid gap-4">{active.content}</div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setActiveIndex(index - 1)}
          disabled={isFirst}
          className="inline-flex items-center justify-center rounded-full border border-white/10 bg-bgPrimary px-4 py-2 text-[12px] font-black text-textPrimary disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← Back
        </button>

        {isLast ? (
          <span className="text-[12px] font-semibold text-textSecondary">
            You&apos;re all set.
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setActiveIndex(index + 1)}
            className="inline-flex items-center justify-center rounded-full bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary"
          >
            Continue: {steps[index + 1]!.label} →
          </button>
        )}
      </div>
    </div>
  )
}

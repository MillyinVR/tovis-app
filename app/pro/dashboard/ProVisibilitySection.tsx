// app/pro/dashboard/ProVisibilitySection.tsx
//
// "Why you're showing up" — the pro-side transparency surface (spec §6.5).
// Sits below "Your Looks performance": that section says what happened, this one
// says why, and what to pull. Purely presentational — it renders the DTO built
// by lib/pro/visibilityHealth.ts and makes no decisions of its own.
//
// Tone convention: the DTO carries a semantic status; classes are mapped here at
// the component boundary (never a color in the loader), using the tone
// utilities so it stays white-label + [data-mode] safe.
import Link from 'next/link'

import type {
  ProVisibilityHealthDTO,
  ProVisibilityLeverDTO,
  ProVisibilityStatus,
} from '@/lib/pro/visibilityHealth'

type ProVisibilitySectionProps = {
  visibility: ProVisibilityHealthDTO
}

const STATUS_LABEL: Record<ProVisibilityStatus, string> = {
  ACTION: 'Action needed',
  ATTENTION: 'Opportunity',
  GOOD: 'Healthy',
  UNKNOWN: 'Not measured yet',
}

function statusChipClass(status: ProVisibilityStatus): string {
  switch (status) {
    case 'ACTION':
      return 'border-toneDanger/30 bg-toneDanger/10 text-toneDanger'
    case 'ATTENTION':
      return 'border-toneWarn/30 bg-toneWarn/10 text-toneWarn'
    case 'GOOD':
      return 'border-toneSuccess/30 bg-toneSuccess/10 text-toneSuccess'
    case 'UNKNOWN':
      return 'border-toneInfo/30 bg-toneInfo/10 text-toneInfo'
  }
}

export default function ProVisibilitySection({
  visibility,
}: ProVisibilitySectionProps) {
  return (
    <section
      className="brand-pro-overview-section"
      aria-labelledby="pro-visibility-title"
    >
      <div
        id="pro-visibility-title"
        className="brand-cap brand-pro-overview-section-title"
      >
        ◆ WHY YOU&rsquo;RE SHOWING UP
      </div>

      <div className="brand-pro-overview-muted brand-pro-looks-insights-sub">
        {visibility.discoverable
          ? 'What is helping and hurting how often clients see your work.'
          : 'You are not appearing in discovery yet. Start here.'}
      </div>

      <ul className="mt-4 flex list-none flex-col gap-3 p-0">
        {visibility.levers.map((lever) => (
          <LeverRow key={lever.key} lever={lever} />
        ))}
      </ul>

      <LookBreakdown looks={visibility.looks} />

      <NotMeasuredNote notMeasured={visibility.notMeasured} />
    </section>
  )
}

function LeverRow({ lever }: { lever: ProVisibilityLeverDTO }) {
  return (
    <li className="rounded-xl border border-textPrimary/10 bg-bgSurface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="brand-pro-overview-metric-value text-base">
          {lever.headline}
        </div>
        <span
          className={`brand-cap rounded-full border px-2 py-0.5 text-[11px] ${statusChipClass(
            lever.status,
          )}`}
        >
          {STATUS_LABEL[lever.status]}
        </span>
      </div>

      <p className="brand-pro-overview-muted mt-1.5 text-sm">{lever.detail}</p>

      {lever.actions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {lever.actions.map((action) => (
            <Link
              key={`${action.href}:${action.label}`}
              href={action.href}
              prefetch={false}
              className="brand-focus rounded-lg border border-textPrimary/15 px-3 py-1.5 text-sm"
            >
              {action.label}
            </Link>
          ))}
        </div>
      ) : null}
    </li>
  )
}

function LookBreakdown({
  looks,
}: {
  looks: ProVisibilityHealthDTO['looks']
}) {
  // Only worth showing the non-live buckets when there is something in them —
  // a clean account shouldn't read as a list of zeros.
  const extras: string[] = []
  if (looks.pendingReviewCount > 0) {
    extras.push(`${looks.pendingReviewCount} awaiting review`)
  }
  if (looks.rejectedCount > 0) {
    extras.push(`${looks.rejectedCount} not approved`)
  }
  if (looks.draftCount > 0) {
    extras.push(`${looks.draftCount} in drafts`)
  }

  return (
    <div className="brand-pro-overview-muted mt-4 text-sm">
      {looks.feedEligibleCount} live{' '}
      {looks.feedEligibleCount === 1 ? 'look' : 'looks'} &middot;{' '}
      {looks.distinctTagCount} {looks.distinctTagCount === 1 ? 'tag' : 'tags'}{' '}
      &middot; {looks.distinctServiceCount}{' '}
      {looks.distinctServiceCount === 1 ? 'service' : 'services'}
      {extras.length > 0 ? ` · ${extras.join(' · ')}` : ''}
    </div>
  )
}

function NotMeasuredNote({ notMeasured }: { notMeasured: string[] }) {
  if (notMeasured.length === 0) return null

  return (
    <details className="mt-4">
      <summary className="brand-focus brand-pro-overview-muted cursor-pointer text-sm">
        What does not affect where you appear
      </summary>
      <ul className="brand-pro-overview-muted mt-2 flex list-disc flex-col gap-1 pl-5 text-sm">
        {notMeasured.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </details>
  )
}

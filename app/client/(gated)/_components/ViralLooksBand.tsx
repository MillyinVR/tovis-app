// app/client/(gated)/_components/ViralLooksBand.tsx
import Link from 'next/link'

import type {
  ClientHomeViralLive,
  ClientHomeViralPending,
} from '../_data/getClientHomeData'
import { gradientAvatar, platformFromUrl } from './homeVisuals'
import SubmitViralLookForm from './SubmitViralLookForm'

// Review pipeline shown on a pending request. We only ever surface REQUESTED /
// IN_REVIEW here (APPROVED becomes a "live" look), so the current node maps
// from the request status; "Live" stays pending until approval.
const PIPELINE_STEPS: string[] = ['Submitted', 'Reviewed', 'Shared', 'Live']

function currentStepIndex(status: ClientHomeViralPending['status']): number {
  return status === 'IN_REVIEW' ? 2 : 0
}

function LiveLookHero({
  live,
  moreCount,
}: {
  live: ClientHomeViralLive
  moreCount: number
}) {
  const platform = platformFromUrl(live.sourceUrl)
  const proCount = live._count.approvalFanOuts

  return (
    <div
      className="relative flex min-h-[300px] flex-col overflow-hidden rounded-card border border-textPrimary/10 bg-bgPrimary"
      style={{
        background:
          'radial-gradient(130% 110% at 26% 16%, rgb(var(--accent-primary) / 0.55), rgb(var(--bg-primary)) 60%)',
      }}
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(180deg, rgb(var(--bg-primary) / 0.35) 0%, rgb(var(--bg-primary) / 0) 30%, rgb(var(--bg-primary) / 0.2) 55%, rgb(var(--bg-primary) / 0.9) 100%)',
        }}
      />
      <div className="relative flex flex-1 flex-col p-4">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-ember/55 bg-bgPrimary/50 px-2.5 py-[5px]">
            <span className="vl-pulse h-1.5 w-1.5 rounded-full bg-ember" />
            <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-textPrimary">
              Live now
            </span>
          </span>
          {platform ? (
            <span className="rounded-full bg-bgPrimary/50 px-2.5 py-[5px] font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-textSecondary">
              via {platform}
            </span>
          ) : null}
        </div>

        <div className="mt-auto">
          <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-textMuted">
            Trending this week
          </div>
          <div className="mb-2 font-display text-[25px] font-bold leading-[1.04] tracking-[-0.03em] text-textPrimary">
            {live.name}
          </div>
          {proCount > 0 ? (
            <div className="mb-3.5 flex items-center gap-2">
              <div className="flex">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="h-5 w-5 rounded-full border-[1.5px] border-bgPrimary"
                    style={{ background: gradientAvatar(i), marginLeft: i === 0 ? 0 : -7 }}
                  />
                ))}
              </div>
              <span className="text-[12px] text-textSecondary">
                {proCount} {proCount === 1 ? 'pro' : 'pros'} now offer this
              </span>
            </div>
          ) : (
            <div className="mb-3.5 text-[12px] text-textSecondary">
              Newly approved — pros are picking it up now.
            </div>
          )}
          <Link
            href={`/search?q=${encodeURIComponent(live.name)}`}
            className="flex h-11 items-center justify-center rounded-[13px] bg-cta font-display text-[13.5px] font-bold text-onCta transition hover:opacity-95"
          >
            Book this look
          </Link>
          {moreCount > 0 ? (
            <Link
              href="/looks"
              className="mt-2.5 block text-center font-display text-[12px] font-semibold text-textSecondary transition hover:text-textPrimary"
            >
              +{moreCount} more live in the feed →
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function LiveLookEmpty() {
  return (
    <div className="flex min-h-[300px] flex-col justify-center rounded-card border border-textPrimary/10 bg-bgSurface p-[18px]">
      <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-textMuted">
        Live now
      </div>
      <div className="mb-2 font-display text-[20px] font-semibold tracking-[-0.02em] text-textPrimary">
        No viral looks live yet
      </div>
      <p className="text-[12.5px] leading-relaxed text-textSecondary">
        Be the first — submit a look you&apos;re seeing everywhere and we&apos;ll
        get it named, vetted, and matched to pros.
      </p>
    </div>
  )
}

function PendingPipeline({ status }: { status: ClientHomeViralPending['status'] }) {
  const current = currentStepIndex(status)

  return (
    <div className="mb-3.5 flex">
      {PIPELINE_STEPS.map((step, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'pending'
        const dotClass =
          state === 'done'
            ? 'bg-terra'
            : state === 'current'
              ? 'bg-gold ring-[3px] ring-gold/20'
              : 'bg-textPrimary/16'
        const leftDone = i > 0 && i <= current
        const rightDone = i < current
        return (
          <div key={step} className="flex flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              <div
                className={`h-0.5 flex-1 ${
                  i === 0 ? 'bg-transparent' : leftDone ? 'bg-terra' : 'bg-textPrimary/10'
                }`}
              />
              <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${dotClass}`} />
              <div
                className={`h-0.5 flex-1 ${
                  i === PIPELINE_STEPS.length - 1
                    ? 'bg-transparent'
                    : rightDone
                      ? 'bg-terra'
                      : 'bg-textPrimary/10'
                }`}
              />
            </div>
            <div
              className={`mt-[7px] whitespace-nowrap font-mono text-[8px] uppercase tracking-[0.04em] ${
                state === 'pending' ? 'text-textMuted/70' : 'text-textSecondary'
              }`}
            >
              {step}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PendingLookHero({
  pending,
  moreCount,
}: {
  pending: ClientHomeViralPending
  moreCount: number
}) {
  const platform = platformFromUrl(pending.sourceUrl)
  const sharedCount = pending._count.approvalFanOuts

  return (
    <div className="flex flex-col rounded-card border border-textPrimary/10 bg-bgSurface p-[18px]">
      <div className="mb-3.5 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-gold px-2.5 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-gold" />
          <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-gold">
            Pending
          </span>
        </span>
        {platform ? (
          <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.1em] text-textMuted">
            via {platform}
          </span>
        ) : null}
      </div>

      <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-textMuted">
        Your request
      </div>
      <div className="mb-4 font-display text-[21px] font-bold leading-[1.05] tracking-[-0.025em] text-textPrimary">
        {pending.name}
      </div>

      <PendingPipeline status={pending.status} />

      <div className="mt-auto rounded-[12px] border border-textPrimary/10 bg-[rgb(var(--surface-glass)/0.05)] px-3.5 py-[11px]">
        <div className="text-[12.5px] leading-relaxed text-textSecondary">
          {sharedCount > 0 ? (
            <>
              Shared with{' '}
              <span className="font-semibold text-textPrimary">
                {sharedCount} {sharedCount === 1 ? 'pro' : 'pros'}
              </span>{' '}
              in your area. We&apos;ll notify you the moment it&apos;s bookable.
            </>
          ) : (
            <>
              In review with our team. We&apos;ll share it with pros and notify
              you the moment it&apos;s bookable.
            </>
          )}
        </div>
      </div>
      {moreCount > 0 ? (
        <span className="mt-3 block text-center font-display text-[12px] font-semibold text-textMuted">
          {moreCount} more pending
        </span>
      ) : null}
    </div>
  )
}

function PendingLookEmpty() {
  return (
    <div className="flex flex-col justify-center rounded-card border border-textPrimary/10 bg-bgSurface p-[18px]">
      <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-textMuted">
        Your requests
      </div>
      <div className="mb-2 font-display text-[18px] font-semibold tracking-[-0.015em] text-textPrimary">
        Nothing pending yet
      </div>
      <p className="text-[12.5px] leading-relaxed text-textSecondary">
        Submit a viral look and you&apos;ll track its review — submitted,
        reviewed, shared, live — right here.
      </p>
    </div>
  )
}

export default function ViralLooksBand({
  viralLive,
  viralPending,
}: {
  viralLive: ClientHomeViralLive[]
  viralPending: ClientHomeViralPending[]
}) {
  const live = viralLive[0] ?? null
  const pending = viralPending[0] ?? null

  return (
    <section className="relative mx-auto max-w-[1040px] px-4 pt-[34px] md:px-8">
      <div className="mb-[18px] border-t border-textPrimary/10 pt-[26px]">
        <div className="mb-2 flex items-center gap-2">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="text-gold">
            <path d="M13 2L4.5 13.5H11l-1 8.5L18.5 10.5H12z" />
          </svg>
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-textMuted">
            New tab in your Looks feed
          </span>
        </div>
        <h2 className="mb-1.5 font-display text-[26px] font-semibold tracking-[-0.03em] text-textPrimary">
          Viral Looks
        </h2>
        <p className="max-w-[620px] text-[14px] leading-relaxed text-textSecondary">
          Spot a look blowing up online? We get it{' '}
          <span className="text-textPrimary">named, vetted, and matched to pros</span>{' '}
          who actually do it — so you can book the exact viral look, by the exact
          name.
        </p>
      </div>

      <div className="grid items-stretch gap-3.5 md:grid-cols-2 lg:grid-cols-[1.15fr_1fr_1fr]">
        {live ? (
          <LiveLookHero live={live} moreCount={Math.max(0, viralLive.length - 1)} />
        ) : (
          <LiveLookEmpty />
        )}
        {pending ? (
          <PendingLookHero
            pending={pending}
            moreCount={Math.max(0, viralPending.length - 1)}
          />
        ) : (
          <PendingLookEmpty />
        )}
        <SubmitViralLookForm />
      </div>
    </section>
  )
}

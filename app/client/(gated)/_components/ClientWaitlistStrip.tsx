// app/client/(gated)/_components/ClientWaitlistStrip.tsx
import Link from 'next/link'

import { initialsForName } from '@/lib/initials'

import type { ClientHomeWaitlistEntry } from '../_data/getClientHomeData'
import { gradientAvatar, professionalName } from './homeVisuals'

function serviceName(entry: ClientHomeWaitlistEntry): string {
  return entry.service?.name ?? 'Service'
}

function WaitlistRow({
  entry,
  index,
  showDivider,
}: {
  entry: ClientHomeWaitlistEntry
  index: number
  showDivider: boolean
}) {
  const proName = professionalName(entry.professional)
  const title = serviceName(entry)

  return (
    <Link
      href={`/professionals/${encodeURIComponent(entry.professional.id)}`}
      className={`flex items-center gap-3 py-2.5${
        showDivider ? ' border-b border-textPrimary/10' : ''
      }`}
    >
      <div
        className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full text-[10px] font-bold text-onCta"
        style={{ background: gradientAvatar(index) }}
      >
        {entry.professional.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={entry.professional.avatarUrl}
            alt={proName}
            className="h-full w-full object-cover"
          />
        ) : (
          initialsForName(proName)
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate font-display text-[13.5px] font-semibold text-textPrimary">
          {title}
        </div>
        <div className="mt-0.5 truncate text-[11.5px] text-textMuted">
          with {proName}
        </div>
      </div>
      <span className="shrink-0 rounded-full bg-terra/10 px-2.5 py-[5px] font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-terra">
        #{index + 1} in line
      </span>
    </Link>
  )
}

export default function ClientWaitlistStrip({
  waitlists,
}: {
  waitlists: ClientHomeWaitlistEntry[]
}) {
  const rows = waitlists.slice(0, 6)

  return (
    <section className="rounded-card border border-textPrimary/10 bg-bgSurface p-[18px]">
      <div className="mb-3.5 flex items-center justify-between">
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-textMuted">
          On the waitlist
        </span>
        {rows.length > 0 ? (
          <span className="font-mono text-[10px] text-textMuted/70">
            {waitlists.length} active
          </span>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <div>
          <p className="text-[12.5px] leading-relaxed text-textMuted">
            You&apos;re not on any waitlists. Join one and we&apos;ll hold your
            place here.
          </p>
          <Link
            href="/discover"
            className="mt-3 inline-flex rounded-[12px] border border-textPrimary/16 px-4 py-2 text-[11.5px] font-bold text-textSecondary transition hover:border-terra/30 hover:text-terra"
          >
            Find services →
          </Link>
        </div>
      ) : (
        <div className="flex flex-col">
          {rows.map((entry, index) => (
            <WaitlistRow
              key={entry.id}
              entry={entry}
              index={index}
              showDivider={index < rows.length - 1}
            />
          ))}
        </div>
      )}
    </section>
  )
}

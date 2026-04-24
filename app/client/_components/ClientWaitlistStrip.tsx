// app/client/_components/ClientWaitlistStrip.tsx
import Link from 'next/link'

import type { ClientHomeWaitlistEntry } from '../_data/getClientHomeData'

function professionalName(professional: {
  businessName: string | null
  handle?: string | null
}): string {
  return (
    professional.businessName ??
    professional.handle ??
    'Professional'
  ).trim()
}

function initialsForName(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length === 0) return 'P'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function serviceName(entry: ClientHomeWaitlistEntry): string {
  return entry.service?.name ?? 'Service'
}

function Avatar({
  src,
  alt,
}: {
  src: string | null
  alt: string
}) {
  return (
    <div
      className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden border border-textPrimary/8 bg-bgSurface"
      style={{ borderRadius: 10 }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <span className="text-xs font-bold text-textMuted">
          {initialsForName(alt)}
        </span>
      )}
    </div>
  )
}

function EmptyWaitlistCard() {
  return (
    <div
      className="overflow-hidden border border-textPrimary/16"
      style={{
        borderRadius: 14,
        background:
          'linear-gradient(135deg, rgba(224,90,40,0.06) 0%, rgba(20,17,14,1) 55%)',
      }}
    >
      <div
        className="border-b px-4 py-3"
        style={{ borderColor: 'rgba(224,90,40,0.16)' }}
      >
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-terra">
          ◆ Nothing waiting
        </span>
      </div>
      <div className="p-4">
        <p className="text-[13px] font-semibold text-textPrimary">
          No waitlists yet.
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-textMuted">
          Join a pro or service waitlist and it&apos;ll show up here.
        </p>
        <Link
          href="/discover"
          className="mt-3.5 inline-flex rounded-[10px] border border-textPrimary/16 px-4 py-2 text-[11px] font-bold text-textSecondary transition hover:border-terra/30 hover:text-terra"
        >
          Find services
        </Link>
      </div>
    </div>
  )
}

function WaitlistRow({
  entry,
  position,
}: {
  entry: ClientHomeWaitlistEntry
  position: number
}) {
  const proName = professionalName(entry.professional)
  const title = serviceName(entry)
  const location = entry.professional.location?.trim() || null

  return (
    <Link
      href={`/professionals/${encodeURIComponent(entry.professional.id)}`}
      className="group flex items-center justify-between gap-4 border border-textPrimary/16 bg-bgSecondary px-3 py-3 transition hover:border-textPrimary/25"
      style={{ borderRadius: 14 }}
    >
      <div className="flex min-w-0 items-center gap-3">
        <Avatar src={entry.professional.avatarUrl} alt={proName} />

        <div className="min-w-0">
          <p className="truncate text-[13px] font-bold text-textPrimary">
            {title}
          </p>
          <p className="mt-0.5 truncate text-[12px] text-textSecondary">
            {proName}
            {location ? ` · ${location}` : ''}
          </p>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <p
          className="font-display text-[22px] font-semibold italic leading-none text-accentPrimaryHover"
        >
          #{position}
        </p>
        <p className="mt-0.5 font-mono text-[8px] uppercase tracking-[0.14em] text-textMuted">
          in line
        </p>
      </div>
    </Link>
  )
}

export default function ClientWaitlistStrip({
  waitlists,
}: {
  waitlists: ClientHomeWaitlistEntry[]
}) {
  return (
    <section className="px-4">
      <div className="mb-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
          <span className="text-terra">◆</span>
          <span className="ml-1.5 text-textMuted">Your Waitlists</span>
        </span>
      </div>

      {waitlists.length === 0 ? (
        <EmptyWaitlistCard />
      ) : (
        <div className="grid gap-2">
          {waitlists.slice(0, 6).map((entry, index) => (
            <WaitlistRow key={entry.id} entry={entry} position={index + 1} />
          ))}
        </div>
      )}
    </section>
  )
}

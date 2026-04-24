// app/client/_components/ClientLastMinuteInvites.tsx
import Link from 'next/link'

import type { ClientHomeLastMinuteInvite } from '../_data/getClientHomeData'

// Portrait gradient pool — cycles by invite index
const PORTRAIT_GRADIENTS = [
  'linear-gradient(155deg, #c0622a 0%, #4e2410 45%, #0a0807 100%)',
  'linear-gradient(160deg, #d47840 0%, #5e2e14 50%, #0d0906 100%)',
  'linear-gradient(135deg, #e08c52 0%, #6b3318 42%, #180c07 100%)',
  'linear-gradient(170deg, #a84e20 0%, #401c0a 55%, #0c0806 100%)',
  'linear-gradient(145deg, #d87038 0%, #5c2c14 48%, #160a06 100%)',
  'linear-gradient(165deg, #b05830 0%, #42200e 48%, #0f0806 100%)',
]

function money(
  value: { toString(): string } | number | string | null,
): string | null {
  if (value == null) return null
  const numeric =
    typeof value === 'number' ? value : Number.parseFloat(value.toString())
  if (!Number.isFinite(numeric)) return null
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(numeric)
}

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

function firstWord(name: string): string {
  return name.split(/\s+/)[0] ?? name
}

function initialsForName(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean)
  if (parts.length === 0) return 'P'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase()
}

function inviteTitle(invite: ClientHomeLastMinuteInvite): string {
  const serviceNames = invite.opening.services
    .map((row) => row.service.name.trim())
    .filter(Boolean)
  if (serviceNames.length === 0) return 'Last-minute opening'
  if (serviceNames.length === 1) return serviceNames[0]
  return `${serviceNames[0]} + ${serviceNames.length - 1} more`
}

function invitePrice(invite: ClientHomeLastMinuteInvite): string | null {
  const firstService = invite.opening.services[0]
  if (!firstService) return null
  return (
    money(firstService.offering.salonPriceStartingAt) ??
    money(firstService.offering.mobilePriceStartingAt) ??
    money(firstService.service.minPrice)
  )
}

function inviteDiscount(invite: ClientHomeLastMinuteInvite): string | null {
  const tier = invite.notifiedTier ?? invite.firstMatchedTier
  const plan = invite.opening.tierPlans.find((item) => item.tier === tier)
  if (!plan) return null
  if (plan.percentOff != null) return `-${plan.percentOff}%`
  if (plan.amountOff) return `${money(plan.amountOff)} off`
  if (plan.freeAddOnService?.name) return plan.freeAddOnService.name
  return null
}

function inviteHref(invite: ClientHomeLastMinuteInvite): string | null {
  const offeringId = invite.opening.services[0]?.offeringId
  if (!offeringId) return null
  return `/offerings/${encodeURIComponent(offeringId)}?scheduledFor=${encodeURIComponent(
    invite.opening.startAt.toISOString(),
  )}&source=DISCOVERY&openingId=${encodeURIComponent(invite.opening.id)}`
}

function relativeDay(date: Date): string {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  )
  const diff = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
  )
  if (diff === 0) return date.getHours() >= 17 ? 'Tonight' : 'Today'
  if (diff === 1) return 'Tomorrow'
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

function formatTime(date: Date, timeZone?: string | null): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: timeZone || undefined,
    }).format(date)
  } catch {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    }).format(date)
  }
}

function tierContextText(invite: ClientHomeLastMinuteInvite): string {
  const day = relativeDay(invite.opening.startAt)
  const tier = invite.notifiedTier ?? invite.firstMatchedTier
  if (tier === 'WAITLIST') return `priority spot ${day.toLowerCase()}`
  if (tier === 'REACTIVATION') return `saved ${day.toLowerCase()} for you`
  return `has a spot ${day.toLowerCase()}`
}

function InviteCard({
  invite,
  index,
}: {
  invite: ClientHomeLastMinuteInvite
  index: number
}) {
  const href = inviteHref(invite)
  const title = inviteTitle(invite)
  const proName = professionalName(invite.opening.professional)
  const firstName = firstWord(proName)
  const discount = inviteDiscount(invite)
  const price = invitePrice(invite)
  const dayLabel = relativeDay(invite.opening.startAt)
  const timeLabel = formatTime(
    invite.opening.startAt,
    invite.opening.timeZone,
  )
  const contextText = tierContextText(invite)
  const gradient =
    PORTRAIT_GRADIENTS[index % PORTRAIT_GRADIENTS.length] ??
    PORTRAIT_GRADIENTS[0]

  const card = (
    <div
      className="w-40 shrink-0 overflow-hidden border border-textPrimary/16 bg-bgSecondary"
      style={{ borderRadius: 16 }}
    >
      {/* Top row: avatar + name + context */}
      <div className="flex items-center gap-2.5 px-3 pt-2.5 pb-2">
        <div className="grid h-[34px] w-[34px] shrink-0 place-items-center overflow-hidden rounded-full border border-textPrimary/16 bg-bgSurface text-[10px] font-bold text-textMuted">
          {invite.opening.professional.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={invite.opening.professional.avatarUrl}
              alt={proName}
              className="h-full w-full object-cover"
            />
          ) : (
            initialsForName(proName)
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-bold text-textPrimary">
            {firstName}
          </p>
          <p className="truncate text-[10px] text-textMuted">{contextText}</p>
        </div>
      </div>

      {/* Image area */}
      <div
        className="relative mx-2"
        style={{
          height: 80,
          borderRadius: 10,
          background: gradient,
          overflow: 'hidden',
        }}
      >
        {invite.opening.professional.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={invite.opening.professional.avatarUrl}
            alt={proName}
            className="h-full w-full object-cover opacity-40"
          />
        )}
        <div
          className="absolute inset-0"
          style={{ background: 'rgba(10,9,7,0.25)' }}
        />

        {discount && (
          <div
            className="absolute right-2 top-2 rounded-full px-2 py-0.5 font-mono text-[9px] font-extrabold text-acid"
            style={{
              background: 'rgba(10,9,7,0.65)',
              backdropFilter: 'blur(6px)',
              letterSpacing: '0.08em',
            }}
          >
            {discount}
          </div>
        )}

        <div
          className="absolute bottom-2 left-2 rounded-full px-2 py-0.5 font-mono text-[9px] text-textMuted"
          style={{
            background: 'rgba(10,9,7,0.65)',
            backdropFilter: 'blur(6px)',
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          {dayLabel}
        </div>
      </div>

      {/* Service + price info */}
      <div className="px-3 pt-2.5 pb-3">
        <p className="truncate text-[12px] font-bold text-textPrimary">
          {title}
        </p>
        <p className="mt-0.5 text-[10px] text-textMuted">{timeLabel}</p>

        <div className="mt-2.5 flex items-end justify-between">
          {price ? (
            <p className="font-display text-[16px] font-semibold leading-none text-textPrimary">
              {price}
            </p>
          ) : (
            <p className="text-[11px] font-bold text-textPrimary">
              Last-minute
            </p>
          )}
          <span className="font-mono text-[10px] font-bold text-terra">
            Book →
          </span>
        </div>
      </div>
    </div>
  )

  if (!href) return <div>{card}</div>

  return (
    <Link href={href} aria-label={`Book ${title} with ${proName}`}>
      {card}
    </Link>
  )
}

const SKELETON = 'rgba(244,239,231,0.07)'

function GhostInviteCards() {
  const ghosts = [
    {
      gradient: PORTRAIT_GRADIENTS[0]!,
      opacity: 1,
      borderColor: 'rgba(224,90,40,0.28)',
      bg: 'rgba(224,90,40,0.06)',
    },
    {
      gradient: PORTRAIT_GRADIENTS[2]!,
      opacity: 0.62,
      borderColor: 'rgba(244,239,231,0.10)',
      bg: undefined,
    },
    {
      gradient: PORTRAIT_GRADIENTS[4]!,
      opacity: 0.3,
      borderColor: 'rgba(244,239,231,0.08)',
      bg: undefined,
    },
  ]
  return (
    <div
      className="flex gap-2.5 overflow-x-hidden pb-1"
      style={{ paddingLeft: 16, paddingRight: 16 }}
    >
      {ghosts.map(({ gradient, opacity, borderColor, bg }, i) => (
        <div
          key={i}
          className="w-40 shrink-0 overflow-hidden border bg-bgSecondary"
          style={{ borderRadius: 16, opacity, borderColor, background: bg ?? undefined }}
        >
          <div className="flex items-center gap-2.5 px-3 pt-2.5 pb-2">
            <div
              className="h-[34px] w-[34px] shrink-0 rounded-full"
              style={{ background: SKELETON }}
            />
            <div className="flex-1 space-y-1.5">
              <div className="h-2.5 w-14 rounded-full" style={{ background: SKELETON }} />
              <div className="h-2 w-20 rounded-full" style={{ background: SKELETON }} />
            </div>
          </div>
          <div
            className="mx-2"
            style={{ height: 80, borderRadius: 10, background: gradient }}
          />
          <div className="px-3 pt-2.5 pb-3">
            <div className="h-2.5 w-24 rounded-full" style={{ background: SKELETON }} />
            <div className="mt-1.5 h-2 w-14 rounded-full" style={{ background: SKELETON }} />
            <div className="mt-3 h-4 w-10 rounded-full" style={{ background: SKELETON }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export default function ClientLastMinuteInvites({
  invites,
}: {
  invites: ClientHomeLastMinuteInvite[]
}) {
  return (
    <section>
      {/* Section header */}
      <div className="mb-3 flex items-center justify-between px-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em]">
          <span className="text-terra">◆</span>
          <span className="ml-1.5 text-textMuted">Your Invites</span>
        </span>
        {invites.length > 0 && (
          <Link
            href="/discover"
            className="text-[11px] font-bold text-textMuted transition hover:text-textSecondary"
          >
            View all
          </Link>
        )}
      </div>

      {invites.length === 0 ? (
        <>
          <GhostInviteCards />
          <div className="mt-3 px-4">
            <Link
              href="/discover"
              className="inline-flex rounded-[10px] border border-textPrimary/16 px-4 py-2 text-[11px] font-bold text-textMuted transition hover:border-terra/30 hover:text-terra"
            >
              Browse pros for last-minute spots →
            </Link>
          </div>
        </>
      ) : (
        <div
          className="flex gap-2.5 overflow-x-auto pb-1 looksNoScrollbar"
          style={{ paddingLeft: 16, paddingRight: 16 }}
        >
          {invites.slice(0, 8).map((invite, index) => (
            <InviteCard key={invite.id} invite={invite} index={index} />
          ))}
        </div>
      )}
    </section>
  )
}

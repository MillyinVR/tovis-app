// app/client/(gated)/_components/ClientLastMinuteInvites.tsx
import Link from 'next/link'

import { initialsForName } from '@/lib/initials'
import RemoteImage from '@/app/_components/media/RemoteImage'
import ProProfileLink from '@/app/_components/ProProfileLink'
import { daySerialInTimeZone, formatInTimeZone } from '@/lib/time'
import { incentiveLabel } from '@/lib/lastMinute/openingDto'
import { pickRecipientTierPlan } from '@/lib/lastMinute/pickTierPlan'

import type { ClientHomeLastMinuteInvite } from '../_data/getClientHomeData'
import { firstWord, gradientAvatar, money, professionalName } from './homeVisuals'

function inviteTitle(invite: ClientHomeLastMinuteInvite): string {
  const serviceNames = invite.opening.services
    .map((row) => row.service.name.trim())
    .filter(Boolean)
  const firstServiceName = serviceNames[0]
  if (firstServiceName === undefined) return 'Last-minute opening'
  if (serviceNames.length === 1) return firstServiceName
  return `${firstServiceName} + ${serviceNames.length - 1} more`
}

/**
 * A STARTING price — the fields say so themselves and the pro re-quotes at the
 * consultation — so it reads "From $180", never a bare figure.
 */
function invitePrice(invite: ClientHomeLastMinuteInvite): string | null {
  const firstService = invite.opening.services[0]
  if (!firstService) return null
  const amount =
    money(firstService.offering.salonPriceStartingAt) ??
    money(firstService.offering.mobilePriceStartingAt) ??
    money(firstService.service.minPrice)
  return amount ? `From ${amount}` : null
}

function inviteHref(invite: ClientHomeLastMinuteInvite): string | null {
  const offeringId = invite.opening.services[0]?.offeringId
  if (!offeringId) return null
  return `/offerings/${encodeURIComponent(offeringId)}?scheduledFor=${encodeURIComponent(
    invite.opening.startAt.toISOString(),
  )}&source=DISCOVERY&openingId=${encodeURIComponent(invite.opening.id)}`
}

// "today" / "tomorrow" is a claim about the OPENING's day, so it has to be
// counted in the opening's zone — the same one formatTime renders the clock in,
// or the label and the time can disagree across a midnight boundary. The old
// version used the runtime's local calendar (`new Date(y, m, d)`), which on
// Vercel is UTC, so an evening appointment could read "tomorrow".
function relativeDay(date: Date, timeZone?: string | null): string {
  const tz = timeZone ?? 'UTC'
  const diff = daySerialInTimeZone(date, tz) - daySerialInTimeZone(new Date(), tz)

  if (diff === 0) return 'today'
  if (diff === 1) return 'tomorrow'

  return formatInTimeZone(
    date,
    tz,
    { weekday: 'short', month: 'short', day: 'numeric' },
  )
}

function formatTime(date: Date, timeZone?: string | null): string {
  // Opening (appointment) time: format in the opening's timezone. A null/invalid
  // tz sanitizes to UTC, matching the prior no-tz fallback (server zone = UTC).
  return formatInTimeZone(
    date,
    timeZone ?? 'UTC',
    {
      hour: 'numeric',
      minute: '2-digit',
    },
  )
}

function hasToday(invites: ClientHomeLastMinuteInvite[]): boolean {
  return invites.some((invite) => relativeDay(invite.opening.startAt, invite.opening.timeZone) === 'today')
}

function InviteRow({
  invite,
  index,
  showDivider,
}: {
  invite: ClientHomeLastMinuteInvite
  index: number
  showDivider: boolean
}) {
  const href = inviteHref(invite)
  const proName = professionalName(invite.opening.professional)
  const proFirst = firstWord(proName)
  const proId = invite.opening.professional.id
  const time = formatTime(invite.opening.startAt, invite.opening.timeZone)
  const day = relativeDay(invite.opening.startAt, invite.opening.timeZone)
  const title = inviteTitle(invite)
  const price = invitePrice(invite)
  const place = invite.opening.professional.location?.trim() || null
  // This RSC gets the DOMAIN row, not the serialized DTO, so it resolves the
  // matched tier the same way the serializer does — through the SAME two shared
  // helpers, never a re-derivation, so home / feed / claim page cannot word one
  // offer three ways.
  const matchedPlan = pickRecipientTierPlan({
    notifiedTier: invite.notifiedTier,
    firstMatchedTier: invite.firstMatchedTier,
    tierPlans: invite.opening.tierPlans,
  })
  const incentive = matchedPlan ? incentiveLabel(matchedPlan) : null

  const meta = [place, price].filter(Boolean).join(' · ')

  const grab = (
    <span className="shrink-0 rounded-full bg-terra px-3.5 py-2 font-display text-[12px] font-bold text-onCta">
      Grab it
    </span>
  )

  return (
    <div
      className={`flex items-center gap-3 py-2.5${
        showDivider ? ' border-b border-textPrimary/10' : ''
      }`}
    >
      <ProProfileLink
        proId={proId}
        label={proName}
        underline={false}
        className="shrink-0 rounded-[11px]"
      >
        <div
          className="grid h-[38px] w-[38px] shrink-0 place-items-center overflow-hidden rounded-[11px] text-[10px] font-bold text-onCta"
          style={{ background: gradientAvatar(index) }}
        >
          {invite.opening.professional.avatarUrl ? (
            <RemoteImage
              src={invite.opening.professional.avatarUrl}
              alt={proName}
              className="h-full w-full object-cover"
              width={38}
              height={38}
            />
          ) : (
            initialsForName(proName)
          )}
        </div>
      </ProProfileLink>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-display text-[13.5px] font-semibold text-textPrimary">
            <ProProfileLink
              proId={proId}
              label={proName}
              title={`View ${proName}'s profile`}
            >
              {proFirst}
            </ProProfileLink>{' '}
            · {title}
          </span>
          {/*
            The offer sits right beside the service, bigger and bolder than the
            line it's on — this card is the FIRST place a client sees a
            last-minute opening, and the incentive (not the not-yet-final
            starting price) is what makes it worth acting on.
          */}
          {incentive ? (
            <span className="shrink-0 rounded-[8px] bg-accentPrimary px-2 py-0.5 font-display text-[14px] font-bold uppercase leading-tight text-onAccent">
              {incentive}
            </span>
          ) : null}
        </div>
        <div className="mt-0.5 truncate text-[11.5px] text-textMuted">
          {time} {day}
          {meta ? ` · ${meta}` : ''}
        </div>
      </div>
      {href ? (
        <Link href={href} aria-label={`Book ${title} with ${proName}`}>
          {grab}
        </Link>
      ) : (
        grab
      )}
    </div>
  )
}

export default function ClientLastMinuteInvites({
  invites,
}: {
  invites: ClientHomeLastMinuteInvite[]
}) {
  const rows = invites.slice(0, 5)

  return (
    <section className="rounded-card border border-textPrimary/10 bg-bgSurface p-[18px]">
      <div className="mb-3.5 flex items-center gap-2">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" className="text-gold">
          <path d="M13 2L4.5 13.5H11l-1 8.5L18.5 10.5H12z" />
        </svg>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-textMuted">
          Last-minute openings
        </span>
        {hasToday(invites) ? (
          <span className="rounded-full bg-gold/15 px-2.5 py-1 font-mono text-[9.5px] font-bold uppercase tracking-[0.06em] text-gold">
            Today
          </span>
        ) : null}
        {/* UNCONDITIONAL, like the iOS card's "See all" (HomeView OpeningsFeedView
            link): /client/openings is the only surface listing every last-minute
            opening, and this strip caps at 5. Gating the link on having invites
            would strand the feed exactly when the strip has nothing to show —
            the same trap CLIENT_TABS documents for /client/bookings. */}
        <Link
          href="/client/openings"
          className="ml-auto shrink-0 font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-accentPrimary transition hover:opacity-80"
        >
          See all
        </Link>
      </div>

      {rows.length === 0 ? (
        <div>
          <p className="text-[12.5px] leading-relaxed text-textMuted">
            No last-minute openings right now. We&apos;ll ping you the moment a
            pro opens a spot.
          </p>
          <Link
            href="/search"
            className="mt-3 inline-flex rounded-[12px] border border-textPrimary/16 px-4 py-2 text-[11.5px] font-bold text-textSecondary transition hover:border-terra/30 hover:text-terra"
          >
            Browse pros →
          </Link>
        </div>
      ) : (
        <div className="flex flex-col">
          {rows.map((invite, index) => (
            <InviteRow
              key={invite.id}
              invite={invite}
              index={index}
              showDivider={index < rows.length - 1}
            />
          ))}
        </div>
      )}

      {/* The full claim surface — priority offers with live countdowns PLUS any
          pro-proposed waitlist times. Outside the empty branch on purpose: those
          two feeds are different data, so a client can have a pro-proposed time
          waiting with zero last-minute invites. Until now /client/offers had no
          in-app entry at all — its only route was the push notification, so a
          client who dismissed that notification could never get back to it. */}
      <Link
        href="/client/offers"
        className="mt-3.5 flex items-center justify-center gap-1 text-[12.5px] font-semibold text-accentPrimary transition hover:opacity-80"
      >
        Your priority offers <span aria-hidden>→</span>
      </Link>
    </section>
  )
}

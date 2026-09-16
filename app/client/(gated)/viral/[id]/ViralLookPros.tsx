// app/client/(gated)/viral/[id]/ViralLookPros.tsx
//
// The list a client reaches by tapping a viral look: the pros who explicitly
// said "I can do this", and a way through to booking each of them.
//
// Honest at zero, one and many (the handoff's alignment checklist). Zero is the
// case that matters most — it is the state every newly approved look starts in,
// and the whole reason this page exists is that the home page used to claim
// otherwise.
import Link from 'next/link'

import ProProfileLink from '@/app/_components/ProProfileLink'
import { Avatar, buttonClassName } from '@/app/_components/ui'
import { viralOfferingProCountLabel } from '@/lib/brand/viralLooksCopy'
import { formatProfessionLabel } from '@/lib/profiles/publicProfileFormatting'
import { professionalProfileHref } from '@/lib/profiles/profileHrefs'
import type { ClientViralLookPro } from '@/lib/viralRequests/liveLooks'

function ProRow({ pro, index }: { pro: ClientViralLookPro; index: number }) {
  const craft = formatProfessionLabel(pro.professionType)

  return (
    <li className="flex items-center gap-3 rounded-[15px] border border-textPrimary/10 bg-[rgb(var(--surface-glass)/0.05)] p-3">
      <ProProfileLink
        proId={pro.id}
        label={pro.name}
        underline={false}
        className="shrink-0"
      >
        <Avatar name={pro.name} src={pro.avatarUrl} index={index} size="lg" />
      </ProProfileLink>

      <div className="min-w-0 flex-1">
        <ProProfileLink
          proId={pro.id}
          label={pro.name}
          underline={false}
          className="block truncate font-display text-[14px] font-semibold tracking-[-0.01em] text-textPrimary transition hover:opacity-80"
        />
        <div className="mt-0.5 truncate text-[11.5px] text-textMuted">
          {[craft, pro.location].filter(Boolean).join(' · ')}
        </div>
      </div>

      {/*
        The path toward booking, and no further. "I can do this" is a pro saying
        they can do the look — it is NOT a price, a duration or an appointment
        (handoff §4.2, still Tori's call), so this hands the client to the pro's
        own profile where the real offerings and prices live, rather than
        inventing a service to book.
      */}
      <Link
        href={professionalProfileHref(pro.id)}
        className={buttonClassName({
          variant: 'primary',
          size: 'sm',
          shape: 'pill',
          className: 'shrink-0',
        })}
      >
        Book
      </Link>
    </li>
  )
}

export default function ViralLookPros({
  pros,
  offeringProCount,
  lookName,
  brandName,
}: {
  pros: ClientViralLookPro[]
  /** The true total; larger than `pros.length` only when the list is capped. */
  offeringProCount: number
  lookName: string
  /** The brand's display name — it names the count's platform-wide scope. */
  brandName: string
}) {
  if (pros.length === 0) {
    return (
      <div className="rounded-card border border-textPrimary/10 bg-bgSurface p-[18px]">
        <div className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.16em] text-textMuted">
          Who does this look
        </div>
        <div className="mb-2 font-display text-[18px] font-semibold tracking-[-0.015em] text-textPrimary">
          No pros have taken this one on yet
        </div>
        <p className="text-[12.5px] leading-relaxed text-textSecondary">
          {lookName} is approved and we&apos;ve shared it with the pros whose
          services match. None of them has said yes yet &mdash; check back, or
          browse pros and ask.
        </p>
        <Link
          href="/search"
          className={buttonClassName({
            variant: 'ghost',
            size: 'sm',
            shape: 'soft',
            className: 'mt-3.5',
          })}
        >
          Browse pros
        </Link>
      </div>
    )
  }

  const hidden = Math.max(0, offeringProCount - pros.length)

  return (
    <section className="grid gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-[17px] font-semibold tracking-[-0.02em] text-textPrimary">
          Who does this look
        </h2>
        {/* "3 pros" beside a list of three reads as "three near me". The
            count is every eligible pro on the platform, and the heading says so
            — same sentence family as the lede above it. */}
        <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-textMuted">
          {viralOfferingProCountLabel(offeringProCount, brandName)}
        </span>
      </div>

      <ul className="grid gap-2.5">
        {pros.map((pro, index) => (
          <ProRow key={pro.id} pro={pro} index={index} />
        ))}
      </ul>

      {hidden > 0 ? (
        <p className="text-center text-[12px] text-textMuted">
          Showing {pros.length} of {offeringProCount}.
        </p>
      ) : null}
    </section>
  )
}

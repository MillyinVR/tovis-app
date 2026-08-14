// app/(main)/booking/AvailabilityDrawer/components/WhereBlock.tsx
'use client'

import { mapsHrefFromLocation } from '@/lib/maps'

import type {
  AvailabilityLocationOption,
  AvailabilityServiceArea,
  ServiceLocationType,
} from '../types'

/**
 * Where this appointment happens — on the sheet, before the client commits.
 *
 * Tori, 2026-08-14: *"when a client chooses a pro from the looks feed or lands
 * on the booking option they salon address or if they are mobile a city radius
 * should show. if the client doesnt know where the pro is located they wont
 * book. the address should be clickable."*
 *
 * The sheet used to show a place only via `SalonLocationSelector`, which renders
 * nothing below two locations — so the overwhelmingly common pro, the one with a
 * single salon, showed the client no location at all.
 *
 * 🔴 **Area always, exact address only when the pro published it** (Tori's call,
 * 2026-08-14). `/availability/bootstrap` is unauthenticated and a "salon" is
 * frequently a home studio, so `ProfessionalLocation.isAddressPublic` decides
 * whether `formattedAddress` reaches this component at all; when it hasn't, the
 * city still does. Either way the line is tappable — a city-level maps link is
 * still the answer to "is that near me?", which is the question this block
 * exists to answer.
 */
type Props = {
  locationType: ServiceLocationType
  /** The salon/suite the client is booking into (SALON mode). */
  location: AvailabilityLocationOption | null
  /** The pro's travel reach (MOBILE mode). */
  serviceArea: AvailabilityServiceArea | null
  /** The client's chosen service address (MOBILE mode), once they've picked one. */
  clientAddress: string | null
}

function Row(props: {
  icon: 'pin' | 'car'
  title: string
  subtitle?: string | null
  href?: string | null
}) {
  const body = (
    <span className="flex min-w-0 items-start gap-2">
      <span aria-hidden className="mt-[1px] shrink-0 text-[13px] leading-none">
        {props.icon === 'car' ? '🚗' : '📍'}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-black leading-5 text-textPrimary">
          {props.title}
        </span>
        {props.subtitle ? (
          <span className="block text-[12px] font-semibold leading-5 text-textSecondary">
            {props.subtitle}
          </span>
        ) : null}
      </span>
    </span>
  )

  if (!props.href) return <div className="min-w-0">{body}</div>

  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer"
      className="brand-focus block min-w-0 rounded-[10px] underline-offset-2 hover:underline"
    >
      {body}
    </a>
  )
}

export default function WhereBlock(props: Props) {
  const { locationType, location, serviceArea, clientAddress } = props

  const rows: React.ReactNode[] = []

  if (locationType === 'MOBILE') {
    // Tori asked for BOTH halves — the pro's reach as the standing fact, and the
    // client's own address confirmed. Only the FIRST is drawn here: mobile mode
    // always renders `MobileAddressSelector` directly below this block, and that
    // card already names the chosen address under "Choose where the pro should
    // come for this booking". Repeating it here printed the same street twice,
    // two rows apart. `clientAddress` stays in the props as the seam for a
    // surface that shows this block WITHOUT the selector (native).
    if (serviceArea) {
      const radius = serviceArea.radiusMiles
      const area = serviceArea.areaLabel
      const title =
        radius != null && area
          ? `Travels up to ${radius} mi around ${area}`
          : radius != null
            ? `Travels up to ${radius} mi`
            : `Travels around ${area}`

      rows.push(<Row key="area" icon="car" title={title} />)
    }

  } else if (location) {
    // `formattedAddress` is already gated on `isAddressPublic` server-side, so
    // its absence here means "this pro has not published a street address",
    // never "we forgot to ask for it".
    const address = location.formattedAddress?.trim() || null
    const area = location.areaLabel?.trim() || null
    const name = location.name?.trim() || null

    const title = address ?? area ?? name
    if (title) {
      rows.push(
        <Row
          key="salon"
          icon="pin"
          title={title}
          subtitle={address && name ? name : address ? null : name}
          href={mapsHrefFromLocation({ formattedAddress: title })}
        />,
      )
    }
  }

  if (rows.length === 0) return null

  return (
    <div
      data-testid="booking-sheet-where"
      className="tovis-glass-soft mb-3 grid gap-2 rounded-card p-3"
    >
      {rows}
    </div>
  )
}

import RemoteImage from '@/app/_components/media/RemoteImage'
import type { BookingBeforeAfterThumbs } from '@/lib/media/bookingBeforeAfter'

/**
 * The before/after split shown anywhere that links to a client's aftercare
 * summary (home action card, aftercare inbox, the booking aftercare step …).
 * Renders the visit's primary before + after photos side by side using the
 * canonical session-photo styling. Returns `null` when no photos exist, so
 * callers can fall back to their own placeholder.
 *
 * Data comes from {@link loadBookingBeforeAfterThumbs} — this component owns
 * only the presentation, and is the single SSOT for the before/after pair.
 */
function photoAlt(label: 'Before' | 'After', serviceName: string | null) {
  return serviceName ? `${label} photo — ${serviceName}` : `${label} photo`
}

function Tile(props: {
  label: 'Before' | 'After'
  url: string | null
  serviceName: string | null
}) {
  return (
    <div className="brand-pro-session-photo-tile">
      {props.url ? (
        <RemoteImage
          src={props.url}
          alt={photoAlt(props.label, props.serviceName)}
          className="brand-pro-session-photo-img"
          intrinsic
        />
      ) : null}

      <span
        className="brand-pro-session-photo-label"
        data-tone={props.label === 'After' ? 'after' : undefined}
      >
        {props.label.toUpperCase()}
      </span>
    </div>
  )
}

export default function AftercareBeforeAfter(props: {
  media: BookingBeforeAfterThumbs
  serviceName?: string | null
  className?: string
}) {
  const { beforeUrl, afterUrl } = props.media
  if (!beforeUrl && !afterUrl) return null

  const serviceName = props.serviceName ?? null

  return (
    <div
      className={['brand-pro-session-photo-grid', props.className ?? '']
        .join(' ')
        .trim()}
      data-columns="2"
    >
      <Tile label="Before" url={beforeUrl} serviceName={serviceName} />
      <Tile label="After" url={afterUrl} serviceName={serviceName} />
    </div>
  )
}

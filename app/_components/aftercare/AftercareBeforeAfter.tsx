import ClickableMedia from '@/app/_components/media/ClickableMedia'
import type { BookingBeforeAfterThumbs } from '@/lib/media/bookingBeforeAfter'

/**
 * The before/after split shown anywhere that links to a client's aftercare
 * summary (home action card, aftercare inbox, the booking aftercare step …).
 * Renders the visit's primary before + after photos side by side using the
 * canonical session-photo styling, each opening full-size on tap. Returns
 * `null` when no photos exist, so callers can fall back to their own
 * placeholder.
 *
 * Data comes from {@link loadBookingBeforeAfterThumbs} — this component owns
 * only the presentation, and is the single SSOT for the before/after pair.
 * The pair is always the primary IMAGE per phase (the loader filters to
 * images), so `mediaType` is fixed to `IMAGE`.
 */
function photoAlt(label: 'Before' | 'After', serviceName: string | null) {
  return serviceName ? `${label} photo — ${serviceName}` : `${label} photo`
}

function PhotoLabel({ label }: { label: 'Before' | 'After' }) {
  return (
    <span
      className="brand-pro-session-photo-label"
      data-tone={label === 'After' ? 'after' : undefined}
    >
      {label.toUpperCase()}
    </span>
  )
}

function Tile(props: {
  label: 'Before' | 'After'
  thumbUrl: string | null
  fullUrl: string | null
  serviceName: string | null
}) {
  if (props.thumbUrl) {
    return (
      <ClickableMedia
        thumbSrc={props.thumbUrl}
        fullSrc={props.fullUrl}
        mediaType="IMAGE"
        alt={photoAlt(props.label, props.serviceName)}
        className="brand-pro-session-photo-tile"
      >
        <PhotoLabel label={props.label} />
      </ClickableMedia>
    )
  }

  // No photo for this half — keep the branded placeholder tile + label.
  return (
    <div className="brand-pro-session-photo-tile">
      <PhotoLabel label={props.label} />
    </div>
  )
}

export default function AftercareBeforeAfter(props: {
  media: BookingBeforeAfterThumbs
  serviceName?: string | null
  className?: string
}) {
  const { beforeUrl, afterUrl, beforeFullUrl, afterFullUrl } = props.media
  if (!beforeUrl && !afterUrl) return null

  const serviceName = props.serviceName ?? null

  return (
    <div
      className={['brand-pro-session-photo-grid', props.className ?? '']
        .join(' ')
        .trim()}
      data-columns="2"
    >
      <Tile
        label="Before"
        thumbUrl={beforeUrl}
        fullUrl={beforeFullUrl}
        serviceName={serviceName}
      />
      <Tile
        label="After"
        thumbUrl={afterUrl}
        fullUrl={afterFullUrl}
        serviceName={serviceName}
      />
    </div>
  )
}

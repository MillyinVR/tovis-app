import BeforeAfterReveal from '@/app/_components/media/BeforeAfterReveal'
import ClickableMedia from '@/app/_components/media/ClickableMedia'
import ClientMediaExportButton from '@/app/_components/media/ClientMediaExportButton'
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
  /**
   * The visit's pro, when this pair is shown to a CLIENT — offers signed
   * export/share crediting that pro (tovis-ios PR #285's web counterpart).
   * `null` (the default) for callers that don't offer it — this component is
   * also used pro-side, and pro-side callers pass nothing here, unchanged.
   */
  clientExportProfessionalId?: string | null
}) {
  const { beforeUrl, afterUrl, beforeFullUrl, afterFullUrl } = props.media
  if (!beforeUrl && !afterUrl) return null

  const serviceName = props.serviceName ?? null
  const professionalId = props.clientExportProfessionalId ?? null

  // Both halves present → the interactive reveal slider (parity with the iOS
  // BeforeAfterCompareView). Only one half → fall back to the branded tiles
  // below, which keep a labelled placeholder for the missing side.
  if (beforeUrl && afterUrl) {
    return (
      <div className="relative">
        <BeforeAfterReveal
          beforeSrc={beforeUrl}
          afterSrc={afterUrl}
          beforeAlt={photoAlt('Before', serviceName)}
          afterAlt={photoAlt('After', serviceName)}
          className={props.className}
        />
        {professionalId ? (
          // The slider has no tap-to-fullscreen (it's a drag surface), so —
          // same as the Looks/review surfaces — share sits outside it as its
          // own corner button rather than a tap-through on the slider.
          <div className="absolute right-2 top-2">
            <ClientMediaExportButton
              professionalId={professionalId}
              className="border border-white/12 bg-bgPrimary/25 text-white/90 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl hover:bg-white/10"
              media={{ kind: 'pair', beforeUrl: beforeFullUrl ?? beforeUrl, afterUrl: afterFullUrl ?? afterUrl }}
            />
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="relative">
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
      {professionalId ? (
        <SingleTileExportButton
          professionalId={professionalId}
          url={afterFullUrl ?? afterUrl ?? beforeFullUrl ?? beforeUrl}
        />
      ) : null}
    </div>
  )
}

/** Only one of before/after exists (the Tile-fallback branch) — export
 * whichever single photo is actually present. `url` is null only when BOTH
 * are missing, which the caller has already returned null for. */
function SingleTileExportButton({
  professionalId,
  url,
}: {
  professionalId: string
  url: string | null
}) {
  if (!url) return null
  return (
    <div className="absolute right-2 top-2">
      <ClientMediaExportButton
        professionalId={professionalId}
        className="border border-white/12 bg-bgPrimary/25 text-white/90 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl hover:bg-white/10"
        media={{ kind: 'single', url }}
      />
    </div>
  )
}

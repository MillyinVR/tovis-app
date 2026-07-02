// app/pro/bookings/[id]/session/_components/SessionPhotoGrid.tsx
import Link from 'next/link'
import ClickableMedia from '@/app/_components/media/ClickableMedia'
import { UI_SIZES } from '@/app/(main)/ui/layoutConstants'

type PhotoLabel = 'Before' | 'After'

export type SessionPhotoGridItem = {
  id: string
  mediaType: 'IMAGE' | 'VIDEO'
  caption: string | null
  renderUrl: string | null
  renderThumbUrl: string | null
}

function CheckIcon({ size = 10 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function PlusIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

/**
 * The before/after photo set shown on the session capture pages and hub.
 * Renders the real captured media as branded tiles that open the shared
 * full-screen {@link ClickableMedia} viewer on tap (images and videos). Fills
 * up to `minTiles` with "add" slots — a link to `addHref` when provided, else
 * an inert dashed placeholder.
 */
export default function SessionPhotoGrid({
  items,
  label,
  addHref,
  minTiles = 3,
}: {
  items: SessionPhotoGridItem[]
  label: PhotoLabel
  addHref?: string
  minTiles?: number
}) {
  const footerOffsetPx = UI_SIZES.footerHeight ?? 0
  const emptyCount = Math.max(0, minTiles - items.length)

  return (
    <div className="brand-pro-session-photo-grid">
      {items.map((item) => {
        const thumb = item.renderThumbUrl || item.renderUrl
        const full = item.renderUrl || item.renderThumbUrl

        return (
          <ClickableMedia
            key={item.id}
            thumbSrc={thumb}
            fullSrc={full}
            mediaType={item.mediaType}
            alt={`${label} photo`}
            caption={item.caption}
            footerOffsetPx={footerOffsetPx}
            className="brand-pro-session-photo-tile"
          >
            <span className="brand-pro-session-photo-check">
              <CheckIcon size={10} />
            </span>
            <span
              className="brand-pro-session-photo-label"
              data-tone={label === 'After' ? 'after' : undefined}
            >
              {label.toUpperCase()}
            </span>
          </ClickableMedia>
        )
      })}

      {Array.from({ length: emptyCount }, (_, index) =>
        addHref ? (
          <Link
            key={`empty-${index}`}
            href={addHref}
            className="brand-pro-session-photo-add brand-focus"
            aria-label={`Add ${label.toLowerCase()} photo`}
          >
            <PlusIcon />
          </Link>
        ) : (
          <div key={`empty-${index}`} className="brand-pro-session-photo-add" aria-hidden="true">
            <PlusIcon />
          </div>
        ),
      )}
    </div>
  )
}

// app/pro/portfolio/_components/ProPortfolioTile.tsx
'use client'

import RemoteImage from '@/app/_components/media/RemoteImage'
import { resolveDisplayCrop } from '@/lib/media/cropRect'
import { cn } from '@/lib/utils'
import { formatCompactCount } from '@/lib/format/compactCount'

import type { ProPortfolioMark, ProPortfolioTile } from '../_data/proPortfolioTypes'

const MARK_LABEL: Record<ProPortfolioMark, string> = {
  SIGNATURE: 'Signature',
  COVER: 'Cover',
  // One chip, not two stacked — the pro made one decision about this photo
  // twice over, and two badges would read as two different claims.
  SIGNATURE_COVER: 'Signature · Cover',
}

type Props = {
  tile: ProPortfolioTile
  /** Public tiles open the manage sheet; private ones open publish or consent. */
  onOpen: (tile: ProPortfolioTile) => void
}

export default function ProPortfolioTileCard({ tile, onOpen }: Props) {
  const held = tile.hold !== null
  const isPublic = tile.publishedAt !== null
  // The frame the pro published — the same rect the feed, the grids and the
  // heroes render, so a re-frame shows up here too.
  const { cropRect, focalPoint } = resolveDisplayCrop(tile)

  return (
    <button
      type="button"
      onClick={() => onOpen(tile)}
      aria-label={buildAccessibleName(tile)}
      className={cn(
        'brand-focus relative block aspect-[3/4] w-full overflow-hidden rounded-[14px]',
        'border border-textPrimary/10 bg-textPrimary/5 text-left',
        'transition hover:border-textPrimary/25 active:scale-[0.995]',
      )}
    >
      <RemoteImage
        src={tile.src}
        alt={tile.caption ?? ''}
        className={cn(
          'block h-full w-full object-cover',
          // A held photo reads as not-yet-yours at a glance, before any copy.
          held ? 'opacity-55 grayscale' : '',
        )}
        focalPoint={focalPoint}
        cropRect={cropRect}
        intrinsic
      />

      {/* 🔴 A pair is INDICATED here, never rendered as a live slider.
          `BeforeAfterReveal` defaults to owning every gesture the moment a
          pointer lands (`touch-action: none`, and a tap moves the divider), so
          embedding it would eat the tap this tile exists to receive — the same
          trap as a recognised gesture swallowing a scroll. The comparison is
          the tile's content; the tap belongs to the tile. */}
      {tile.before ? (
        <>
          <span
            className="pointer-events-none absolute inset-y-0 left-[52%] w-[2px] bg-textPrimary/85"
            aria-hidden="true"
          />
          <span
            className={cn(
              'pointer-events-none absolute left-[52%] top-1/2 grid h-6 w-6 -translate-x-1/2 -translate-y-1/2',
              'place-items-center rounded-full bg-textPrimary font-mono text-[9px] font-bold text-bgPrimary',
            )}
            aria-hidden="true"
          >
            ↔
          </span>
        </>
      ) : null}

      {tile.mark ? (
        <span
          className={cn(
            'absolute left-[7px] top-[7px] inline-flex items-center rounded-[7px] px-[7px] py-[3px]',
            'border border-microAccent/35 bg-microAccent/15 text-microAccent backdrop-blur-sm',
            'font-mono text-[8px] font-bold uppercase tracking-[0.13em]',
          )}
        >
          {MARK_LABEL[tile.mark]}
        </span>
      ) : null}

      {tile.isVideo ? (
        // A fact we actually have. The frame stamped a DURATION here ("0:14"),
        // but MediaAsset stores no duration at all — so this is a glyph.
        <span
          className={cn(
            'absolute right-[7px] top-[7px] grid h-[22px] w-[22px] place-items-center rounded-full',
            'bg-bgPrimary/65 text-textPrimary backdrop-blur-sm',
          )}
          aria-hidden="true"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      ) : null}

      {held && tile.hold ? (
        <span
          className={cn(
            'absolute inset-x-0 bottom-0 flex items-center gap-[5px] px-2 py-[7px]',
            'bg-linear-to-t from-bgPrimary/90 to-transparent text-microAccent',
            'font-mono text-[8px] font-bold uppercase tracking-[0.11em]',
          )}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            className="flex-none"
            aria-hidden="true"
          >
            <rect x="4" y="11" width="16" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 0 1 8 0v4" />
          </svg>
          Waiting on {tile.hold.clientFirstName}
        </span>
      ) : null}

      {!held && !isPublic ? (
        <span
          className={cn(
            'absolute bottom-[7px] right-[7px] grid h-7 w-7 place-items-center rounded-[9px]',
            'bg-accentPrimary text-onAccent',
          )}
          aria-hidden="true"
        >
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
      ) : null}

      {isPublic && tile.engagement ? (
        <span
          className={cn(
            'absolute inset-x-0 bottom-0 flex items-center gap-[9px] px-2 pb-[6px] pt-[14px]',
            'bg-linear-to-t from-bgPrimary/88 to-transparent text-textPrimary',
            'font-mono text-[8.5px] font-bold',
          )}
        >
          <Stat label="views" value={tile.engagement.views} icon="eye" />
          <Stat label="likes" value={tile.engagement.likes} icon="heart" />
          {tile.engagement.booked > 0 ? (
            <Stat
              label="booked"
              value={tile.engagement.booked}
              icon="cal"
              className="text-microAccent"
            />
          ) : null}
        </span>
      ) : null}
    </button>
  )
}

function Stat({
  label,
  value,
  icon,
  className,
}: {
  label: string
  value: number
  icon: 'eye' | 'heart' | 'cal'
  className?: string
}) {
  return (
    <span className={cn('inline-flex items-center gap-[3px]', className)}>
      <svg
        width="9"
        height="9"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {icon === 'eye' ? (
          <>
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
            <circle cx="12" cy="12" r="3" />
          </>
        ) : null}
        {icon === 'heart' ? (
          <path d="M20.8 5.6a5 5 0 0 0-7.1 0L12 7.3l-1.7-1.7a5 5 0 1 0-7.1 7.1L12 21.5l8.8-8.8a5 5 0 0 0 0-7.1z" />
        ) : null}
        {icon === 'cal' ? (
          <>
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M8 3v4M16 3v4M3 10h18" />
          </>
        ) : null}
      </svg>
      <span className="sr-only">{label} </span>
      {formatCompactCount(value)}
    </span>
  )
}

/**
 * 🔴 The tile's whole state has to reach a screen reader, because every visual
 * signal here is positional or graphical: the zone carries public-vs-private,
 * a dimmed photo carries the consent hold, and the counts ride an overlay.
 */
function buildAccessibleName(tile: ProPortfolioTile): string {
  const parts: string[] = [tile.caption ?? 'Untitled photo']

  if (tile.mark) parts.push(MARK_LABEL[tile.mark])
  if (tile.isVideo) parts.push('Video')

  if (tile.hold) {
    parts.push(`Waiting on ${tile.hold.clientFirstName} before it can be published`)
  } else if (tile.publishedAt !== null) {
    parts.push('Public')
    if (tile.engagement) {
      parts.push(
        `${tile.engagement.views} views, ${tile.engagement.likes} likes`,
      )
    }
  } else {
    parts.push('Only you. Tap to publish')
  }

  return parts.join('. ')
}

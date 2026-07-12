// app/professionals/[id]/PortfolioGrid.tsx// app/professionals/[id]/PortfolioGrid.tsx
import Link from 'next/link'

import BeforeAfterReveal from '@/app/_components/media/BeforeAfterReveal'
import RemoteImage from '@/app/_components/media/RemoteImage'
import type { PublicPortfolioTileDto } from '@/lib/profiles/publicProfileMappers'

type PortfolioGridProps = {
  tiles: PublicPortfolioTileDto[]
  emptyMessage: string
}

function mediaHref(mediaId: string): string {
  return `/media/${encodeURIComponent(mediaId)}`
}

// §19f — a portfolio tile IS a look now, so open the look detail (feed post with
// engagement), mirroring the /u/[handle] client grid. Fall back to the media page
// for the rare tile with no backing look.
function tileHref(tile: PublicPortfolioTileDto): string {
  return tile.lookId
    ? `/looks/${encodeURIComponent(tile.lookId)}`
    : mediaHref(tile.id)
}

export default function PortfolioGrid({
  tiles,
  emptyMessage,
}: PortfolioGridProps) {
  if (tiles.length === 0) {
    return (
      <div className="brand-profile-card m-4 p-4 text-[13px] text-textSecondary">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="brand-profile-media-grid">
      {tiles.map((tile, index) => (
        <PortfolioTile
          key={tile.id}
          tile={tile}
          featured={index === 0}
        />
      ))}
    </div>
  )
}

function PortfolioTile({
  tile,
  featured,
}: {
  tile: PublicPortfolioTileDto
  featured: boolean
}) {
  const title = tile.caption ?? 'Open portfolio post'
  const alt = tile.caption ?? 'Portfolio'

  // A paired tile becomes the interactive before/after comparison slider in
  // place of the static image (the slider is the content, so no post link).
  if (tile.before) {
    return (
      <div className="brand-profile-media-tile">
        <BeforeAfterReveal
          beforeSrc={tile.before.thumbUrl ?? tile.before.fullUrl ?? tile.src}
          afterSrc={tile.src}
          beforeAlt={tile.caption ? `Before — ${tile.caption}` : 'Before'}
          afterAlt={tile.caption ? `After — ${tile.caption}` : 'After'}
          className="brand-before-after-fill"
        />
      </div>
    )
  }

  return (
    <Link
      href={tileHref(tile)}
      className="brand-profile-media-tile group"
      title={title}
      aria-label={title}
    >
      <RemoteImage
        src={tile.src}
        alt={alt}
        className="brand-profile-media-img transition duration-200 group-hover:scale-[1.02]"
        intrinsic
      />

      {featured ? (
        <span className="brand-profile-badge absolute left-2 top-2">
          ★ FEAT
        </span>
      ) : null}

      {tile.isVideo ? (
        <span className="brand-profile-pill absolute right-2 top-2">
          VIDEO
        </span>
      ) : null}

      {tile.serviceIds.length > 0 ? (
        <span className="brand-profile-pill absolute bottom-2 left-2">
          SERVICE
        </span>
      ) : null}
    </Link>
  )
}
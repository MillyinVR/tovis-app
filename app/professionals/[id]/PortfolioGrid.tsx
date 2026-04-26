// app/professionals/[id]/PortfolioGrid.tsx// app/professionals/[id]/PortfolioGrid.tsx
import Link from 'next/link'

import type { PublicPortfolioTileDto } from '@/lib/profiles/publicProfileMappers'

type PortfolioGridProps = {
  tiles: PublicPortfolioTileDto[]
  emptyMessage: string
}

function mediaHref(mediaId: string): string {
  return `/media/${encodeURIComponent(mediaId)}`
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

  return (
    <Link
      href={mediaHref(tile.id)}
      className="brand-profile-media-tile group"
      title={title}
      aria-label={title}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={tile.src}
        alt={alt}
        className="brand-profile-media-img transition duration-200 group-hover:scale-[1.02]"
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
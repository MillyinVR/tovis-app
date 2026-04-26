// app/pro/profile/public-profile/_components/ProPortfolioGrid.tsx
import Link from 'next/link'
import { MediaVisibility } from '@prisma/client'

import OwnerMediaMenu from '@/app/_components/media/OwnerMediaMenu'

import type {
  ProProfileManagementPortfolio,
  ProProfileManagementRoutes,
} from '../_data/proProfileManagementTypes'

type ProPortfolioGridProps = {
  routes: ProProfileManagementRoutes
  portfolio: ProProfileManagementPortfolio
}

type PortfolioTile = ProProfileManagementPortfolio['tiles'][number]

export default function ProPortfolioGrid({
  routes,
  portfolio,
}: ProPortfolioGridProps) {
  return (
    <section aria-label="Portfolio assets">
      <div className="brand-pro-profile-media-grid">
        <UploadTile uploadHref={routes.proMediaNew} />

        {portfolio.tiles.map((tile, index) => (
          <PortfolioMediaTile
            key={tile.id}
            tile={tile}
            featured={index === 0}
            serviceOptions={portfolio.serviceOptions}
          />
        ))}
      </div>

      {portfolio.hasLooksEligibleBridge ? (
        <div className="brand-pro-profile-empty">
          “Looks eligible” is a temporary media-level bridge. Published Looks are
          still counted from canonical look posts.
        </div>
      ) : null}

      {portfolio.tiles.length === 0 ? (
        <div className="brand-pro-profile-empty">
          No portfolio assets yet. Upload your best work to start building your
          client-facing profile.
        </div>
      ) : null}
    </section>
  )
}

function UploadTile({ uploadHref }: { uploadHref: string }) {
  return (
    <Link
      href={uploadHref}
      className="brand-pro-profile-upload-tile brand-focus"
      title="Upload portfolio media"
      aria-label="Upload portfolio media"
    >
      <div className="brand-pro-profile-upload-content">
        <div className="brand-pro-profile-upload-plus">+</div>
        <div className="brand-cap">Upload</div>
      </div>
    </Link>
  )
}

function PortfolioMediaTile({
  tile,
  featured,
  serviceOptions,
}: {
  tile: PortfolioTile
  featured: boolean
  serviceOptions: ProProfileManagementPortfolio['serviceOptions']
}) {
  const title = tile.caption ?? 'Open portfolio media'
  const alt = tile.caption ?? 'Portfolio media'

  return (
    <div className="brand-pro-profile-media-tile" title={title}>
      <Link
        href={`/media/${encodeURIComponent(tile.id)}`}
        className="brand-focus"
        aria-label={title}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={tile.src}
          alt={alt}
          className="brand-pro-profile-media-img"
        />
      </Link>

      <div className="brand-pro-profile-owner-menu-wrap">
        <OwnerMediaMenu
          mediaId={tile.id}
          serviceOptions={serviceOptions}
          initial={{
            caption: tile.caption ?? null,
            visibility: tile.visibility,
            isEligibleForLooks: tile.isEligibleForLooks,
            isFeaturedInPortfolio: tile.isFeaturedInPortfolio,
            serviceIds: tile.serviceIds,
          }}
        />
      </div>

      <div className="brand-pro-profile-media-badges">
        {tile.visibility === MediaVisibility.PRO_CLIENT ? (
          <span className="brand-profile-pill">Only you</span>
        ) : null}

        {tile.isEligibleForLooks ? (
          <span className="brand-profile-pill">Looks eligible</span>
        ) : null}

        {tile.isFeaturedInPortfolio ? (
          <span className="brand-pro-profile-portfolio-badge">
            Portfolio
          </span>
        ) : null}
      </div>

      {featured ? (
        <span className="brand-pro-profile-featured-badge">Featured</span>
      ) : null}

      {tile.isVideo ? (
        <span className="brand-pro-profile-video-badge">Video</span>
      ) : null}
    </div>
  )
}
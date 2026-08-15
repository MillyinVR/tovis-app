// app/pro/profile/public-profile/_components/ProPortfolioGrid.tsx
import Link from 'next/link'
import { MediaVisibility } from '@prisma/client'

import BeforeAfterReveal from '@/app/_components/media/BeforeAfterReveal'
import OwnerMediaMenu from '@/app/_components/media/OwnerMediaMenu'
import RemoteImage from '@/app/_components/media/RemoteImage'
import { COPY } from '@/lib/copy'

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

        {/* 🔴 There is no `featured={index === 0}` here any more. The old
            "Featured" badge was drawn from the tile's POSITION in an
            `orderBy: { createdAt: 'desc' }` list — no such field exists on
            MediaAsset — so it crowned whatever the pro uploaded most recently
            and styled it as a curated choice. `Signature` below is the honest
            version: a real, pro-set FK. */}
        {portfolio.tiles.map((tile) => (
          <PortfolioMediaTile
            key={tile.id}
            tile={tile}
            isCover={tile.id === portfolio.coverMediaAssetId}
            isSignature={tile.id === portfolio.signatureMediaAssetId}
            serviceOptions={portfolio.serviceOptions}
          />
        ))}
      </div>

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
  isCover,
  isSignature,
  serviceOptions,
}: {
  tile: PortfolioTile
  isCover: boolean
  isSignature: boolean
  serviceOptions: ProProfileManagementPortfolio['serviceOptions']
}) {
  const title = tile.caption ?? 'Open portfolio media'
  const alt = tile.caption ?? 'Portfolio media'

  return (
    <div className="brand-pro-profile-media-tile" title={title}>
      {tile.before ? (
        // Paired before/after → the comparison slider fills the tile; the owner
        // menu + badges below still let the pro manage the post.
        <BeforeAfterReveal
          beforeSrc={tile.before.thumbUrl ?? tile.before.fullUrl ?? tile.src}
          afterSrc={tile.src}
          beforeAlt={tile.caption ? `Before — ${tile.caption}` : 'Before'}
          afterAlt={tile.caption ? `After — ${tile.caption}` : 'After'}
          className="brand-before-after-fill"
        />
      ) : (
        <Link
          href={`/media/${encodeURIComponent(tile.id)}`}
          className="brand-focus"
          aria-label={title}
        >
          <RemoteImage
            src={tile.src}
            alt={alt}
            className="brand-pro-profile-media-img"
            intrinsic
          />
        </Link>
      )}

      <div className="brand-pro-profile-owner-menu-wrap">
        <OwnerMediaMenu
          mediaId={tile.id}
          serviceOptions={serviceOptions}
          isVideo={tile.isVideo}
          isCover={isCover}
          isSignature={isSignature}
          initial={{
            caption: tile.caption ?? null,
            visibility: tile.visibility,
            isEligibleForLooks: tile.isEligibleForLooks,
            isFeaturedInPortfolio: tile.isFeaturedInPortfolio,
            serviceIds: tile.serviceIds,
            beforeAssetId: tile.before?.id ?? null,
          }}
        />
      </div>

      <div className="brand-pro-profile-media-badges">
        {isSignature ? (
          <span className="brand-pro-profile-portfolio-badge">
            {COPY.publicProfile.signatureLabel}
          </span>
        ) : null}

        {isCover ? (
          <span className="brand-pro-profile-portfolio-badge">Cover</span>
        ) : null}

        {tile.visibility === MediaVisibility.PRO_CLIENT ? (
          <span className="brand-profile-pill">Only you</span>
        ) : null}

        {tile.isFeaturedInPortfolio ? (
          <span className="brand-pro-profile-portfolio-badge">
            Portfolio
          </span>
        ) : null}
      </div>

      {tile.isVideo ? (
        <span className="brand-pro-profile-video-badge">Video</span>
      ) : null}
    </div>
  )
}
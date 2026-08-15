// app/professionals/[id]/_components/SignatureCard.tsx
//
// The pro's SIGNATURE post — one optional, pro-chosen piece of their own work,
// promoted out of the grid and given the page's only inline booking action, so
// an appointment can inherit the picture that prompted it.
//
// 🔴 The label is "Signature" and it must stay that way. "Spotlight" is
// `LookPost.featuredAt` — a SUPER_ADMIN editorial pick whose whole point is that
// the PLATFORM chose you; a pro-applied badge wearing it cashes in credibility
// it did not earn. "Featured" already means four other things in this schema.
// The design frame's own mock says "Spotlight service" here; that is the one
// place this build deliberately departs from it.
import Link from 'next/link'

import BeforeAfterReveal from '@/app/_components/media/BeforeAfterReveal'
import RemoteImage from '@/app/_components/media/RemoteImage'
import { COPY } from '@/lib/copy'
import type { PublicProfileSignatureDto } from '@/lib/profiles/publicProfileMappers'

export default function SignatureCard({
  signature,
}: {
  signature: PublicProfileSignatureDto
}) {
  const { tile, priceLine, bookHref } = signature
  const { engagement } = tile

  return (
    <section className="brand-pp-signature" aria-label="Signature work">
      <div className="brand-pp-signature-media">
        {tile.before ? (
          <BeforeAfterReveal
            beforeSrc={tile.before.thumbUrl ?? tile.before.fullUrl ?? tile.src}
            afterSrc={tile.src}
            beforeAlt={tile.caption ? `Before — ${tile.caption}` : 'Before'}
            afterAlt={tile.caption ? `After — ${tile.caption}` : 'After'}
            className="brand-before-after-fill"
          />
        ) : (
          <RemoteImage
            src={tile.src}
            alt={tile.caption ?? 'Signature work'}
            className="brand-pp-signature-img"
            intrinsic
          />
        )}
      </div>

      <div className="p-4">
        <div className="mb-2.5 flex items-center justify-between gap-2.5">
          <span className="brand-pp-signature-eyebrow">
            <span aria-hidden="true">✦</span>
            {COPY.publicProfile.signatureLabel}
          </span>

          {priceLine ? (
            <span className="font-mono text-[10.5px] tracking-[0.06em] text-textSecondary">
              {priceLine}
            </span>
          ) : null}
        </div>

        {tile.caption ? (
          <div className="text-[15px] leading-[1.5] text-textPrimary">
            {tile.caption}
          </div>
        ) : null}

        {tile.serviceNames.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {tile.serviceNames.map((name) => (
              <span key={name} className="brand-pp-tag">
                {name}
              </span>
            ))}
          </div>
        ) : null}

        <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3.5">
            <span className="brand-pp-count">
              <span aria-hidden="true" className="text-[rgb(var(--color-ember))]">
                ♥
              </span>
              {engagement.likeCount}
              <span className="sr-only"> likes</span>
            </span>

            <span className="brand-pp-count">
              <span aria-hidden="true">💬</span>
              {engagement.commentCount}
              <span className="sr-only"> comments</span>
            </span>
          </div>

          {bookHref ? (
            <Link href={bookHref} className="brand-pp-signature-book brand-focus">
              {COPY.publicProfile.signatureBookCta}
            </Link>
          ) : null}
        </div>

        {/* Zero renders NOTHING — never a literal "0 recreated this". */}
        {engagement.recreatedCount > 0 ? (
          <div className="mt-3 flex items-center gap-2 border-t border-[rgb(var(--surface-glass)/0.12)] pt-3">
            <span
              aria-hidden="true"
              className="font-mono text-[11px] text-[rgb(var(--tone-warn))]"
            >
              ↺
            </span>
            <span className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[rgb(var(--tone-warn))]">
              {engagement.recreatedCount} {COPY.publicProfile.recreatedSuffix}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  )
}

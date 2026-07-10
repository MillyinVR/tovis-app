// app/pro/bookings/[id]/session/after-photos/FeaturedPairPicker.tsx
'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import ClickableMedia from '@/app/_components/media/ClickableMedia'
import { buildFeaturedPairQuery } from '@/lib/aftercare/featuredPairParams'

export type FeaturedPickerItem = {
  id: string
  mediaType: 'IMAGE' | 'VIDEO'
  caption: string | null
  renderUrl: string | null
  renderThumbUrl: string | null
}

function ArrowRightIcon({ size = 12 }: { size?: number }) {
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
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

function Strip({
  items,
  label,
  selectedId,
  onToggle,
}: {
  items: FeaturedPickerItem[]
  label: 'before' | 'after'
  selectedId: string | null
  onToggle: (id: string) => void
}) {
  if (items.length === 0) {
    return (
      <div className="mt-2 text-[11px] font-semibold text-textSecondary">
        No {label} photos yet.
      </div>
    )
  }

  return (
    <div className="mt-2 grid grid-cols-3 gap-2">
      {items.map((m) => {
        const isVideo = m.mediaType === 'VIDEO'
        // The client's reveal comparison is image-only, so only images are
        // featurable (matches the aftercare authoring form).
        const canFeature = !isVideo
        const isFeatured = selectedId === m.id

        // The Feature pill sits OUTSIDE the ClickableMedia button — a nested
        // <button> is invalid — so tapping it toggles the selection without
        // opening the fullscreen viewer.
        return (
          <div key={m.id} className="relative">
            <ClickableMedia
              thumbSrc={m.renderThumbUrl}
              fullSrc={m.renderUrl}
              mediaType={m.mediaType}
              alt={`${label} photo`}
              caption={m.caption}
              hidePlayBadge
              className={[
                'aspect-square rounded-card bg-bgPrimary transition',
                isFeatured
                  ? 'border-2 border-accentPrimary'
                  : 'border border-white/10',
                'hover:bg-surfaceGlass',
              ].join(' ')}
            >
              {isVideo ? (
                <div className="pointer-events-none absolute right-2 top-2 rounded-full border border-white/10 bg-bgSecondary px-2 py-1 text-[10px] font-black text-textPrimary">
                  VIDEO
                </div>
              ) : null}
            </ClickableMedia>

            {canFeature ? (
              <button
                type="button"
                aria-pressed={isFeatured}
                aria-label={
                  isFeatured
                    ? `Remove this ${label} photo as featured`
                    : `Feature this ${label} photo`
                }
                onClick={() => onToggle(m.id)}
                className={[
                  'absolute right-1 top-1 z-10 rounded-full px-2 py-1 text-[10px] font-black transition',
                  isFeatured
                    ? 'bg-accentPrimary text-bgPrimary'
                    : 'border border-white/10 bg-bgSecondary text-textPrimary hover:bg-surfaceGlass',
                ].join(' ')}
              >
                {isFeatured ? '★ Featured' : 'Feature'}
              </button>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

/**
 * The session wrap-up "featured before/after" pre-selection surface. The pro
 * taps "Feature" on a before and an after photo to set the pair the client sees
 * first on their aftercare summary; the choice is carried into the aftercare
 * authoring form as `?fb=`/`?fa=` (no early DB write — the form remains the
 * single persist boundary). URL sync keeps the pick across a page refresh; the
 * "Continue to aftercare" link always carries the live selection.
 */
export default function FeaturedPairPicker({
  aftercareHref,
  beforeItems,
  afterItems,
  initialBeforeId,
  initialAfterId,
}: {
  aftercareHref: string
  beforeItems: FeaturedPickerItem[]
  afterItems: FeaturedPickerItem[]
  initialBeforeId: string | null
  initialAfterId: string | null
}) {
  const [beforeId, setBeforeId] = useState<string | null>(initialBeforeId)
  const [afterId, setAfterId] = useState<string | null>(initialAfterId)

  // Mirror the selection into the URL (no navigation, no server re-render) so a
  // refresh of this force-dynamic page keeps the pro's in-progress pick. Uses
  // the browser location directly — this only ever runs client-side, alongside
  // the history API it drives.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const query = buildFeaturedPairQuery(beforeId, afterId)
    window.history.replaceState(null, '', `${window.location.pathname}?${query}`)
  }, [beforeId, afterId])

  function toggleBefore(id: string) {
    setBeforeId((current) => (current === id ? null : id))
  }

  function toggleAfter(id: string) {
    setAfterId((current) => (current === id ? null : id))
  }

  const continueHref = `${aftercareHref}?${buildFeaturedPairQuery(
    beforeId,
    afterId,
  )}`

  return (
    <section className="brand-pro-session-card" data-tone="success">
      <div className="brand-pro-session-card-heading">
        <span className="brand-pro-session-card-dot" />
        Feature the before/after
      </div>

      <div className="brand-pro-session-card-body">
        Tap <strong>Feature</strong> on a before and an after photo to set the
        pair your client sees first — the rest show as thumbnails. Leave both
        unset to feature the earliest of each. You can change this on the next
        step too.
      </div>

      <div className="mt-3 grid gap-4">
        <div>
          <div className="brand-cap" data-tone="muted">
            Before
          </div>
          <Strip
            items={beforeItems}
            label="before"
            selectedId={beforeId}
            onToggle={toggleBefore}
          />
        </div>

        <div>
          <div className="brand-cap" data-tone="muted">
            After
          </div>
          <Strip
            items={afterItems}
            label="after"
            selectedId={afterId}
            onToggle={toggleAfter}
          />
        </div>
      </div>

      <div className="mt-4">
        <Link
          href={continueHref}
          className="brand-pro-session-button brand-focus"
          data-full="true"
        >
          Continue to aftercare <ArrowRightIcon />
        </Link>
      </div>
    </section>
  )
}

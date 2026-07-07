// app/(main)/search/_components/TrendingTagsRail.tsx
'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { safeJson } from '@/lib/http'
import { parseTrendingTagsResponse, type TrendingTagDto } from '@/lib/discovery/trendingTags'

// Windowed most-used non-banned tags → their /looks/tags/[slug] browse pages.
// This is the D1 tag layer's payoff in Discovery (social-first D2). Chip styling
// mirrors the feed tag chips (LookOverlays) so the tag language reads uniformly.
export default function TrendingTagsRail() {
  const [tags, setTags] = useState<TrendingTagDto[]>([])

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    async function load() {
      try {
        const res = await fetch('/api/v1/discover/trending-tags', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })

        const raw = await safeJson(res)
        if (!active || controller.signal.aborted || !res.ok) return

        setTags(parseTrendingTagsResponse(raw))
      } catch {
        if (active && !controller.signal.aborted) setTags([])
      }
    }

    void load()

    return () => {
      active = false
      controller.abort()
    }
  }, [])

  // Nothing trending yet → render nothing (no empty band).
  if (tags.length === 0) return null

  return (
    <section aria-label="Trending tags">
      <div className="mb-2 px-1 font-mono text-[10px] font-black uppercase tracking-[0.14em] text-textMuted">
        ◆ Trending tags
      </div>

      <div className="looksNoScrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
        {tags.map((tag) => (
          <Link
            key={tag.slug}
            href={`/looks/tags/${encodeURIComponent(tag.slug)}`}
            className="shrink-0 rounded-full border border-accentPrimary/40 bg-bgPrimary/30 px-3 py-1.5 font-mono text-[11px] font-black text-textPrimary transition-colors hover:border-accentPrimary hover:bg-white/10"
          >
            #{tag.display}
          </Link>
        ))}
      </div>
    </section>
  )
}

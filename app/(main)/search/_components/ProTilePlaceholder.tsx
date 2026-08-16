/**
 * The texture a pro tile shows when the pro has no avatar: a diagonal specular
 * sheen plus a fine hatch. Written out byte-identically in `DiscoverGridView`
 * and `TrendingProRail` before this — the same two class strings in two files,
 * which is how a texture drifts.
 *
 * ⚠️ The whites stay RAW, deliberately. This is a sheen over `bg-bgPrimary/45`,
 * so in light mode a 0.08-alpha white over paper is close to invisible and the
 * texture mostly disappears — a real mode-blindness, and one of phase 7's
 * remaining raw-colour entries. Tori's call (2026-08-16) was to consolidate
 * first and leave the colour to whoever owns this tile's look, so that this
 * change moves zero pixels. When that decision comes, it now has one home.
 */
export default function ProTilePlaceholder() {
  return (
    <>
      <div
        aria-hidden
        className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08)_0,rgba(255,255,255,0.02)_35%,rgba(0,0,0,0.24)_100%)]"
      />
      <div
        aria-hidden
        className="absolute inset-0 opacity-20 [background-image:repeating-linear-gradient(135deg,transparent_0,transparent_10px,rgba(255,255,255,0.12)_11px,transparent_12px)]"
      />
    </>
  )
}

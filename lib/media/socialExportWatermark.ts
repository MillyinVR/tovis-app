// lib/media/socialExportWatermark.ts
//
// Whose name is on the picture — a port of tovis-ios TovisKit's
// SocialExportWatermark.swift, narrowed to the one path this feature needs.
// iOS has two callers (a pro signing their OWN work, read from their private
// membership; a client signing a DIFFERENT pro's work, read from that pro's
// PUBLIC profile) that both funnel into one signing function. Web only ever
// has the second case — a client viewing a pro's media already carries
// `header.clientExport.dropsPlatformMark`, resolved server-side
// (lib/pro/socialExportMark.ts) — so there is no membership-shaped overload
// to port here, only the shared decision.

export type ExportWatermark = {
  /** The pro's signature line ("@toristyles", or their business name when
   * they have no handle). Null only when the pro has neither. */
  signature: string | null
  /** The small platform mark beside the signature. Members' plans drop it. */
  showsPlatformMark: boolean
  platformMark: string
}

/** Nothing to draw at all — a pro with no handle and no business name. */
export function isEmptyWatermark(w: ExportWatermark): boolean {
  return w.signature === null && !w.showsPlatformMark
}

/**
 * `"@tori"`, from `"tori"`, `"@tori"`, `" @tori "` or `"@@tori"` alike. Null
 * for empty or "@"-only input, so a blank handle falls through to the
 * business name instead of signing the export "@". Mirrors
 * `SocialExportPolicy.normalizedHandle`.
 */
export function normalizedHandle(raw: string | null | undefined): string | null {
  if (raw == null) return null
  let trimmed = raw.trim()
  while (trimmed.startsWith('@')) trimmed = trimmed.slice(1)
  trimmed = trimmed.trim()
  return trimmed ? `@${trimmed}` : null
}

/**
 * The signature line: the handle if there is one, else the business name,
 * else nothing. Never invents a name. Mirrors `SocialExportPolicy.signature`.
 */
export function signature(
  handle: string | null | undefined,
  businessName: string | null | undefined,
): string | null {
  const handleSig = normalizedHandle(handle)
  if (handleSig) return handleSig
  const name = businessName?.trim()
  return name ? name : null
}

/**
 * The watermark for a client export of a pro's work. `dropsPlatformMark`
 * comes from that pro's `header.clientExport.dropsPlatformMark` (public
 * profile DTO) — server-resolved from their entitlements, mirroring
 * `exportsDropPlatformMark` on `/api/v1/pro/membership/status` exactly, so
 * this file never re-derives the tier rule. Mirrors
 * `SocialExportPolicy.watermark(for:dropsPlatformMark:...)`.
 */
export function clientExportWatermark(args: {
  handle: string | null | undefined
  businessName: string | null | undefined
  dropsPlatformMark: boolean
  platformMark: string
}): ExportWatermark {
  return {
    signature: signature(args.handle, args.businessName),
    showsPlatformMark: !args.dropsPlatformMark,
    platformMark: args.platformMark,
  }
}

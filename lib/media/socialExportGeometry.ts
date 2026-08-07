// lib/media/socialExportGeometry.ts
//
// Where every pixel goes for a client-side signed export — a straight port of
// tovis-ios TovisKit's SocialExportPlan.swift / PublishCrop.swift (the render
// pipeline this feature reuses, per the house rule against forking it). Pure
// arithmetic, normalized 0…1 rects, TOP-LEFT origin throughout — deliberately
// unitless so the same plan works at any canvas size and is trivially testable
// with no DOM/canvas involved.
//
// 🔴 Load-bearing arithmetic, same as the iOS source: a sign error here crops
// somebody out of the picture without crashing and without looking wrong in a
// diff. Keep this file's behavior byte-for-byte aligned with TovisKit's.

export type SocialExportFormat = 'feed916' | 'instagram45'

export const SOCIAL_EXPORT_FORMATS: readonly SocialExportFormat[] = [
  'feed916',
  'instagram45',
]

export type Rect = { x: number; y: number; width: number; height: number }

export function formatPixelSize(format: SocialExportFormat): {
  width: number
  height: number
} {
  switch (format) {
    case 'feed916':
      return { width: 1080, height: 1920 }
    case 'instagram45':
      return { width: 1080, height: 1350 }
  }
}

/** Width ÷ height. Mirrors `PublishCrop.feed` / `PublishCrop.instagramFeed`. */
export function formatAspect(format: SocialExportFormat): number {
  switch (format) {
    case 'feed916':
      return 9 / 16
    case 'instagram45':
      return 4 / 5
  }
}

export function formatShortLabel(format: SocialExportFormat): string {
  return format === 'feed916' ? '9:16' : '4:5'
}

export function formatPlatformLabel(format: SocialExportFormat): string {
  return format === 'feed916' ? 'Reels · TikTok · Looks' : 'Instagram feed'
}

export type PairArrangement = 'sideBySide' | 'stacked'

/**
 * Not a preference — geometry (mirrors `SocialExportFormat.pairArrangement`).
 * Splitting a 9:16 box side by side leaves each half at roughly 0.28 w/h, a
 * letterbox slot no face survives; the same split of a 4:5 box gives a normal
 * tall portrait. So the tall canvas stacks and the squarer one sits side by
 * side.
 */
export function pairArrangement(format: SocialExportFormat): PairArrangement {
  return format === 'feed916' ? 'stacked' : 'sideBySide'
}

/** The upright capture frame's aspect (w/h) — mirrors `PublishCrop.captureAspect`. */
export const CAPTURE_ASPECT = 3 / 4

/**
 * The centered crop of `aspect` (w/h) inside a frame of `frameAspect`, as a
 * normalized top-left rect of that frame. Mirrors `PublishCrop.rect`.
 */
export function publishCropRect(
  aspect: number,
  frameAspect: number = CAPTURE_ASPECT,
): Rect {
  if (aspect <= 0 || frameAspect <= 0) {
    return { x: 0, y: 0, width: 1, height: 1 }
  }
  if (aspect > frameAspect) {
    // Wider than the frame → full width, cropped height.
    const h = frameAspect / aspect
    return { x: 0, y: (1 - h) / 2, width: 1, height: h }
  }
  // Narrower → full height, cropped width.
  const w = aspect / frameAspect
  return { x: (1 - w) / 2, y: 0, width: w, height: 1 }
}

// A Reel's COVER is what stops the scroll, and the platform lays its own
// chrome over the top and bottom of it — mirrors `PublishCrop`'s cover-safe
// band. Published, fixed numbers, nothing to tune.
const COVER_SAFE_TOP_FRACTION = 220 / 1920
const COVER_SAFE_BOTTOM_FRACTION = 450 / 1920

/** The part of a 9:16 rect that survives the Reels cover chrome. */
export function coverSafeRect(feedRect: Rect): Rect {
  const top = feedRect.height * COVER_SAFE_TOP_FRACTION
  const bottom = feedRect.height * COVER_SAFE_BOTTOM_FRACTION
  const height = feedRect.height - top - bottom
  if (height <= 0) return feedRect
  return { x: feedRect.x, y: feedRect.y + top, width: feedRect.width, height }
}

/** One source image, described by size and (optionally) where the subject is. */
export type SocialExportSource = {
  pixelWidth: number
  pixelHeight: number
  /**
   * Normalized top-left subject box in the source, or undefined for a plain
   * centered crop. No DTO this feature reads currently carries focal data
   * (only pro practice shots do — see lib/dto/proPractice.ts), so every call
   * site today passes this as undefined; kept as a real parameter (not
   * deleted) so the port stays complete and a future focal-carrying DTO can
   * use it without another pass through this file.
   */
  subject?: Rect | null
  /** Manual crop nudge, −1…+1. 0 is the smart default. */
  adjust?: number
}

function sourceAspect(source: SocialExportSource): number {
  if (source.pixelWidth <= 0 || source.pixelHeight <= 0) return 1
  return source.pixelWidth / source.pixelHeight
}

function clamped01(value: number): number {
  return Math.min(Math.max(value, 0), 1)
}

const SUBJECT_ANCHOR_Y = 0.44
const SUBJECT_ANCHOR_X = 0.5

function smartOrigin(
  slack: number,
  extent: number,
  subjectCenter: number | null,
  anchor: number,
): number {
  if (slack <= 0) return 0
  if (subjectCenter == null) return slack / 2
  return Math.min(Math.max(subjectCenter - anchor * extent, 0), slack)
}

function applyAdjust(origin: number, slack: number, adjust: number): number {
  if (slack <= 0) return 0
  const a = Math.min(Math.max(adjust, -1), 1)
  const moved = a >= 0 ? origin + a * (slack - origin) : origin + a * origin
  return Math.min(Math.max(moved, 0), slack)
}

/**
 * The crop of a source, as a normalized top-left rect. Mirrors
 * `SocialExportPlanner.crop`: (1) the largest `targetAspect` rect that fits
 * the source, centered; (2) slide it along whichever axis has slack so the
 * subject lands on its anchor; (3) apply the manual nudge across the travel
 * that remains.
 */
export function crop(args: {
  sourceAspect: number
  targetAspect: number
  subject?: Rect | null
  adjust?: number
}): Rect {
  const { sourceAspect: srcAspect, targetAspect, subject, adjust = 0 } = args
  const base = publishCropRect(targetAspect, srcAspect)

  const horizontalSlack = Math.max(0, 1 - base.width)
  const verticalSlack = Math.max(0, 1 - base.height)

  if (verticalSlack > horizontalSlack) {
    const subjectCenterY = subject ? clamped01(subject.y + subject.height / 2) : null
    const smart = smartOrigin(verticalSlack, base.height, subjectCenterY, SUBJECT_ANCHOR_Y)
    const y = applyAdjust(smart, verticalSlack, adjust)
    return { x: base.x, y, width: base.width, height: base.height }
  }

  if (horizontalSlack > 0) {
    const subjectCenterX = subject ? clamped01(subject.x + subject.width / 2) : null
    const smart = smartOrigin(horizontalSlack, base.width, subjectCenterX, SUBJECT_ANCHOR_X)
    const x = applyAdjust(smart, horizontalSlack, adjust)
    return { x, y: base.y, width: base.width, height: base.height }
  }

  // Aspects match — the whole source ships and there is nothing to decide.
  return base
}

export type ExportRole = 'single' | 'before' | 'after'

export type ExportPlacement = {
  /** The part of the SOURCE that survives, as a normalized top-left rect. */
  sourceCrop: Rect
  /** Where it lands in the canvas, in canvas pixels (top-left origin). */
  destination: Rect
  role: ExportRole
}

export type ExportPlan = {
  format: SocialExportFormat
  canvasWidth: number
  canvasHeight: number
  placements: ExportPlacement[]
  /** null for a single shot; the arrangement used for a pair. */
  arrangement: PairArrangement | null
}

/** The hairline between the halves of a diptych, in canvas pixels at 1080 width. */
export const DIPTYCH_GUTTER = 4

/** The two slots a diptych's halves occupy, gutter already removed. */
export function halves(
  canvasWidth: number,
  canvasHeight: number,
  arrangement: PairArrangement,
): [Rect, Rect] {
  if (arrangement === 'sideBySide') {
    const w = (canvasWidth - DIPTYCH_GUTTER) / 2
    return [
      { x: 0, y: 0, width: w, height: canvasHeight },
      { x: canvasWidth - w, y: 0, width: w, height: canvasHeight },
    ]
  }
  const h = (canvasHeight - DIPTYCH_GUTTER) / 2
  return [
    { x: 0, y: 0, width: canvasWidth, height: h },
    { x: 0, y: canvasHeight - h, width: canvasWidth, height: h },
  ]
}

/** The full geometry for a single-shot export. */
export function planSingle(
  format: SocialExportFormat,
  source: SocialExportSource,
): ExportPlan {
  const { width, height } = formatPixelSize(format)
  const placement: ExportPlacement = {
    sourceCrop: crop({
      sourceAspect: sourceAspect(source),
      targetAspect: formatAspect(format),
      subject: source.subject,
      adjust: source.adjust ?? 0,
    }),
    destination: { x: 0, y: 0, width, height },
    role: 'single',
  }
  return {
    format,
    canvasWidth: width,
    canvasHeight: height,
    placements: [placement],
    arrangement: null,
  }
}

/** The full geometry for a before/after diptych export. */
export function planPair(
  format: SocialExportFormat,
  before: SocialExportSource,
  after: SocialExportSource,
): ExportPlan {
  const { width, height } = formatPixelSize(format)
  const arrangement = pairArrangement(format)
  const [beforeSlot, afterSlot] = halves(width, height, arrangement)

  // Each half is cropped to ITS OWN aspect, not the canvas's — that is the
  // whole reason the arrangement is per-format.
  const placement = (source: SocialExportSource, slot: Rect, role: ExportRole): ExportPlacement => {
    const halfAspect = slot.height > 0 ? slot.width / slot.height : formatAspect(format)
    return {
      sourceCrop: crop({
        sourceAspect: sourceAspect(source),
        targetAspect: halfAspect,
        subject: source.subject,
        adjust: source.adjust ?? 0,
      }),
      destination: slot,
      role,
    }
  }

  const placements = [
    placement(before, beforeSlot, 'before'),
    placement(after, afterSlot, 'after'),
  ]

  return { format, canvasWidth: width, canvasHeight: height, placements, arrangement }
}

/** Inset from the canvas edge before anything is drawn, as a fraction of the short edge. */
export const SIGNATURE_INSET_FRACTION = 0.045

/**
 * The box a signature may be drawn in — right-aligned along its bottom edge.
 * Mirrors `SocialExportPlanner.signatureBox`: a 9:16 export is inset to the
 * published Reels cover-safe band so the signature isn't hidden under the
 * platform's own caption/action-rail chrome; a 4:5 feed post has no such
 * overlay and uses the plain inset.
 */
export function signatureBox(
  canvasWidth: number,
  canvasHeight: number,
  format: SocialExportFormat,
): Rect {
  const inset = Math.min(canvasWidth, canvasHeight) * SIGNATURE_INSET_FRACTION
  const full: Rect = {
    x: inset,
    y: inset,
    width: canvasWidth - inset * 2,
    height: canvasHeight - inset * 2,
  }
  return format === 'feed916' ? coverSafeRect(full) : full
}

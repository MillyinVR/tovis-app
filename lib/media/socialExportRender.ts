// lib/media/socialExportRender.ts
//
// The pixels — a port of tovis-ios TovisKit's SocialExportRenderer.swift onto
// the browser Canvas 2D API. Client-side only (uses `Image`/`HTMLCanvasElement`
// /`document`): the render happens ON THE DEVICE, from bytes the server never
// sees, exactly like iOS — this file must never be imported from server code.
//
// All the geometry (crop math, diptych layout, signature box) and the signing
// decision live in socialExportGeometry.ts / socialExportWatermark.ts, both
// pure and unit-tested with no DOM. This file is deliberately thin: it loads
// images, walks a plan, and draws — nothing here should need a test that a
// browser can't run.
import {
  DIPTYCH_GUTTER,
  type ExportPlacement,
  type ExportPlan,
  type SocialExportFormat,
  planPair,
  planSingle,
  signatureBox,
} from '@/lib/media/socialExportGeometry'
import type { ExportWatermark } from '@/lib/media/socialExportWatermark'

/** JPEG quality. High enough a re-compress on the way to Instagram doesn't
 * compound visibly; not 1.0, which buys nothing but megabytes. Mirrors
 * `SocialExportRenderer.jpegQuality`. */
export const JPEG_QUALITY = 0.92

/** Behind the diptych hairline. Near-black rather than white: a dark seam
 * recedes between two frames where a white one reads as an added border. */
const SEAM_COLOR = 'rgb(10, 10, 10)'

const SIGNATURE_POINT_FRACTION = 0.03
const MARK_SCALE = 0.75
const SIGNATURE_ALPHA = 0.82
const MARK_ALPHA = 0.62
const BEFORE_AFTER_ALPHA = 0.7
const MARK_GAP_FRACTION = 0.55

export class SocialExportRenderError extends Error {}

/** Load an image with the crossOrigin needed to read it back off a canvas
 * (Supabase Storage sends `Access-Control-Allow-Origin: *` on every object,
 * public or signed — verified live before building this). */
export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new SocialExportRenderError(`Couldn't load ${url}`))
    img.src = url
  })
}

/** The brand faces as next/font actually named them on this page, falling
 * back to the raw Google Fonts family (loaded elsewhere on the page for
 * ordinary text) if the CSS variable isn't resolvable for some reason. */
function resolveFontFamily(cssVar: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim()
  return value || fallback
}

/** Waits for the page's already-declared web fonts to finish loading, so the
 * FIRST export a viewer renders doesn't draw with a system-font fallback. */
async function ensureFontsReady(): Promise<void> {
  if (typeof document === 'undefined' || !('fonts' in document)) return
  try {
    await document.fonts.ready
  } catch {
    // Non-fatal — worst case the signature draws in a fallback font.
  }
}

function pixelCrop(
  normalized: ExportPlacement['sourceCrop'],
  image: HTMLImageElement,
): { sx: number; sy: number; sw: number; sh: number } {
  const w = image.naturalWidth
  const h = image.naturalHeight
  const rawX = normalized.x * w
  const rawY = normalized.y * h
  const rawW = normalized.width * w
  const rawH = normalized.height * h
  const sx = Math.max(0, Math.min(rawX, w))
  const sy = Math.max(0, Math.min(rawY, h))
  const sw = Math.max(1, Math.min(rawW, w - sx))
  const sh = Math.max(1, Math.min(rawH, h - sy))
  return { sx, sy, sw, sh }
}

type TextRun = { text: string; font: string; alpha: number; tracking: number }

function measureRun(ctx: CanvasRenderingContext2D, run: TextRun): number {
  ctx.font = run.font
  return ctx.measureText(run.text).width + run.tracking * Math.max(0, run.text.length - 1)
}

/** Drawn with a soft dark shadow: a flat white signature vanishes on a blonde
 * balayage, a flat dark one on dark hair — the pair reads on both. */
function drawRun(
  ctx: CanvasRenderingContext2D,
  run: TextRun,
  x: number,
  baselineY: number,
): void {
  ctx.save()
  ctx.font = run.font
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  // Real, widely-supported Canvas2D property (Baseline 2023+); guarded for
  // the rare older browser where tracking just silently doesn't apply.
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${run.tracking}px`
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)'
  ctx.shadowBlur = 6
  ctx.shadowOffsetY = 1
  ctx.fillStyle = `rgba(255, 255, 255, ${run.alpha})`
  ctx.fillText(run.text, x, baselineY)
  ctx.restore()
}

function drawSignature(
  ctx: CanvasRenderingContext2D,
  watermark: ExportWatermark,
  pointSize: number,
  box: { x: number; y: number; width: number; height: number },
): void {
  if (watermark.signature === null && !watermark.showsPlatformMark) return

  const displayFamily = resolveFontFamily('--font-display-face', '"Space Grotesk", sans-serif')
  const monoFamily = resolveFontFamily('--font-mono-face', '"Space Mono", monospace')

  const runs: TextRun[] = []
  if (watermark.signature) {
    runs.push({
      text: watermark.signature,
      font: `${Math.round(pointSize)}px ${displayFamily}`,
      alpha: SIGNATURE_ALPHA,
      tracking: 0,
    })
  }
  if (watermark.showsPlatformMark) {
    runs.push({
      text: watermark.platformMark.toUpperCase(),
      font: `${Math.round(pointSize * MARK_SCALE)}px ${monoFamily}`,
      alpha: MARK_ALPHA,
      tracking: pointSize * 0.08,
    })
  }
  if (runs.length === 0) return

  const gap = pointSize * MARK_GAP_FRACTION
  const sized = runs.map((run) => ({ run, width: measureRun(ctx, run) }))
  const total = sized.reduce((sum, r) => sum + r.width, 0) + gap * Math.max(0, sized.length - 1)

  let x = box.x + box.width - total
  const baselineY = box.y + box.height
  for (const { run, width } of sized) {
    drawRun(ctx, run, x, baselineY)
    x += width + gap
  }
}

function drawPairLabels(ctx: CanvasRenderingContext2D, plan: ExportPlan): void {
  const pointSize =
    Math.min(plan.canvasWidth, plan.canvasHeight) * SIGNATURE_POINT_FRACTION * MARK_SCALE
  const inset = pointSize * 1.1
  const monoFamily = resolveFontFamily('--font-mono-face', '"Space Mono", monospace')

  for (const placement of plan.placements) {
    if (placement.role === 'single') continue
    const run: TextRun = {
      text: placement.role === 'before' ? 'BEFORE' : 'AFTER',
      font: `${Math.round(pointSize)}px ${monoFamily}`,
      alpha: BEFORE_AFTER_ALPHA,
      tracking: pointSize * 0.12,
    }
    const slot = placement.destination
    drawRun(ctx, run, slot.x + inset, slot.y + slot.height - inset)
  }
}

/**
 * Render `plan` from `images` (one per placement, in the plan's order) to a
 * JPEG Blob. Mirrors `SocialExportRenderer.render`.
 */
async function renderPlan(
  plan: ExportPlan,
  images: HTMLImageElement[],
  watermark: ExportWatermark,
): Promise<Blob> {
  if (images.length !== plan.placements.length) {
    throw new SocialExportRenderError(
      `Expected ${plan.placements.length} image(s), got ${images.length}`,
    )
  }
  await ensureFontsReady()

  const canvas = document.createElement('canvas')
  canvas.width = plan.canvasWidth
  canvas.height = plan.canvasHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new SocialExportRenderError('Canvas 2D context unavailable')

  ctx.fillStyle = SEAM_COLOR
  ctx.fillRect(0, 0, plan.canvasWidth, plan.canvasHeight)
  ctx.imageSmoothingQuality = 'high'

  plan.placements.forEach((placement, i) => {
    const image = images[i]
    if (!image) throw new SocialExportRenderError(`No image for placement ${i}`)
    const { sx, sy, sw, sh } = pixelCrop(placement.sourceCrop, image)
    const { x, y, width, height } = placement.destination
    ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height)
  })

  if (plan.placements.length > 1) drawPairLabels(ctx, plan)

  const pointSize = Math.min(plan.canvasWidth, plan.canvasHeight) * SIGNATURE_POINT_FRACTION
  const box = signatureBox(plan.canvasWidth, plan.canvasHeight, plan.format)
  drawSignature(ctx, watermark, pointSize, box)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new SocialExportRenderError('Encode failed'))
          return
        }
        resolve(blob)
      },
      'image/jpeg',
      JPEG_QUALITY,
    )
  })
}

export type RenderSingleArgs = {
  format: SocialExportFormat
  imageUrl: string
  watermark: ExportWatermark
  adjust?: number
}

/** Load, crop, sign, and encode a single-shot export. */
export async function renderSingleExport(args: RenderSingleArgs): Promise<Blob> {
  const image = await loadImage(args.imageUrl)
  const plan = planSingle(args.format, {
    pixelWidth: image.naturalWidth,
    pixelHeight: image.naturalHeight,
    adjust: args.adjust,
  })
  return renderPlan(plan, [image], args.watermark)
}

export type RenderPairArgs = {
  format: SocialExportFormat
  beforeUrl: string
  afterUrl: string
  watermark: ExportWatermark
  adjust?: number
}

/** Load, crop, sign, and encode a before/after diptych export. */
export async function renderPairExport(args: RenderPairArgs): Promise<Blob> {
  const [beforeImage, afterImage] = await Promise.all([
    loadImage(args.beforeUrl),
    loadImage(args.afterUrl),
  ])
  const plan = planPair(
    args.format,
    { pixelWidth: beforeImage.naturalWidth, pixelHeight: beforeImage.naturalHeight, adjust: args.adjust },
    { pixelWidth: afterImage.naturalWidth, pixelHeight: afterImage.naturalHeight, adjust: args.adjust },
  )
  return renderPlan(plan, [beforeImage, afterImage], args.watermark)
}

// Re-exported so callers building a plan preview don't need a second import.
export { DIPTYCH_GUTTER }

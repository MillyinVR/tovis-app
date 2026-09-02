// app/_components/media/CropEditor.tsx
'use client'

// The pro's re-frame surface (capture chain item 4): drag the window, drag a
// corner, save. One crop per look, non-destructive — the bytes never change.
//
// ── What is deliberately NOT in here ────────────────────────────────────────
//
// 🔴 The consent rule. The handles stop at `crop.bound`, but that is a courtesy
// so the pro is not offered a drag the server will refuse — it is not the
// enforcement. PUT /api/v1/pro/media/[id]/crop re-reads the bound from the row
// and re-checks it inside the write. A 403 coming back is rendered, not treated
// as impossible.
//
// 🔴 An aspect lock. Item 3 made the feed CONTAIN its media, so a rect no longer
// has to match any surface's shape. The preset row proposes a starting frame and
// then lets go of it; it does not constrain the drag.
//
// ── Pointer handling ────────────────────────────────────────────────────────
// ── Why the marks are accent-coloured, not white ────────────────────────────
// A mark over a PHOTOGRAPH cannot use a theme-following ink: `textPrimary`
// (and `paper`, which is the same variable) flips with [data-mode], so it goes
// pale-on-pale over half the photos in either mode. The brand's answer to
// "readable on a deliberate fill" is already `accentPrimary` + `onAccent`, so
// the window border and handle fills are the accent and the handle ring is
// `onAccent`, over a scrim that dims everything outside the rect. No new token,
// and no raw colour.
//
// ── Pointer handling ────────────────────────────────────────────────────────
// Pointer events (not mouse/touch pairs) with capture on the element that
// started the gesture, so a fast drag that leaves the image still tracks. Deltas
// are converted to normalized units against the RENDERED box, which is measured
// per gesture rather than cached — the sheet this lives in can resize under it.

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from 'react'

import RemoteImage from '@/app/_components/media/RemoteImage'
import type { ProMediaCrop } from '@/app/_components/media/useProMediaCrop'
import { Button } from '@/app/_components/ui'
import type { CropHandle } from '@/lib/media/cropDrag'
import { cn } from '@/lib/utils'

/** The starting frames offered, in the shapes this product actually ships. */
const PRESETS: { label: string; aspect: number }[] = [
  { label: 'Feed', aspect: 9 / 16 },
  { label: 'Portrait', aspect: 4 / 5 },
  { label: 'Square', aspect: 1 },
]

const HANDLES: { handle: CropHandle; className: string; label: string }[] = [
  { handle: 'nw', className: 'left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize', label: 'top left' },
  { handle: 'ne', className: 'right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize', label: 'top right' },
  { handle: 'sw', className: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize', label: 'bottom left' },
  { handle: 'se', className: 'bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize', label: 'bottom right' },
]

export default function CropEditor({
  crop,
  src,
  alt,
  /** Copy for the undo window, when one is open. Null renders no notice. */
  undoNotice,
  onDone,
}: {
  crop: ProMediaCrop
  src: string
  alt: string
  undoNotice?: string | null
  onDone?: () => void
}) {
  const frameRef = useRef<HTMLDivElement | null>(null)

  /**
   * Pointer pixels → normalized units of the stored frame.
   *
   * Measured per gesture: this editor lives inside a sheet that can resize, and
   * a box cached at mount would silently scale every drag by the wrong factor
   * after a rotation or a keyboard opening.
   */
  const normalize = useCallback((dxPx: number, dyPx: number) => {
    const box = frameRef.current?.getBoundingClientRect()
    if (!box || box.width <= 0 || box.height <= 0) return { dx: 0, dy: 0 }
    return { dx: dxPx / box.width, dy: dyPx / box.height }
  }, [])

  const startGesture = useCallback(
    (
      event: ReactPointerEvent<HTMLElement>,
      apply: (delta: { dx: number; dy: number }) => void,
    ) => {
      event.preventDefault()
      event.stopPropagation()

      const target = event.currentTarget
      target.setPointerCapture?.(event.pointerId)

      let lastX = event.clientX
      let lastY = event.clientY

      const onMove = (e: PointerEvent) => {
        const delta = normalize(e.clientX - lastX, e.clientY - lastY)
        lastX = e.clientX
        lastY = e.clientY
        apply(delta)
      }

      const onUp = () => {
        target.removeEventListener('pointermove', onMove)
        target.removeEventListener('pointerup', onUp)
        target.removeEventListener('pointercancel', onUp)
      }

      target.addEventListener('pointermove', onMove)
      target.addEventListener('pointerup', onUp)
      target.addEventListener('pointercancel', onUp)
    },
    [normalize],
  )

  const { rect, bound } = crop

  return (
    <div className="grid gap-3">
      <div
        ref={frameRef}
        data-testid="crop-frame"
        className="relative w-full overflow-hidden rounded-[16px] bg-textPrimary/5 select-none touch-none"
        // The frame takes the PHOTO's shape, so the rect drawn on it is the
        // rect that will be stored — a fixed 3:4 box would letterbox the image
        // inside it and every normalized drag would be measured against the
        // wrong height.
        style={{ aspectRatio: `${crop.sourceAspect}` }}
      >
        <RemoteImage
          src={src}
          alt={alt}
          intrinsic
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain"
          onLoad={(event) => {
            const img = event.currentTarget
            if (img.naturalHeight > 0) {
              crop.setSourceAspect(img.naturalWidth / img.naturalHeight)
            }
          }}
        />

        {/* Everything outside the rect is dimmed rather than hidden, so the pro
            can see what they are giving up before they give it up. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-scrim/55"
          style={{
            clipPath: `polygon(0% 0%, 0% 100%, ${pct(rect.x)} 100%, ${pct(rect.x)} ${pct(rect.y)}, ${pct(
              rect.x + rect.w,
            )} ${pct(rect.y)}, ${pct(rect.x + rect.w)} ${pct(rect.y + rect.h)}, ${pct(rect.x)} ${pct(
              rect.y + rect.h,
            )}, ${pct(rect.x)} 100%, 100% 100%, 100% 0%)`,
          }}
        />

        {/* The frame the pro may not leave, drawn only when it is not the whole
            photo — otherwise it is just a border on the border. */}
        {!isFullFrame(bound) ? (
          <div
            aria-hidden
            data-testid="crop-bound"
            className="pointer-events-none absolute border border-dashed border-accentPrimary/45"
            style={boxStyle(bound)}
          />
        ) : null}

        <div
          data-testid="crop-window"
          role="application"
          aria-label="Crop window — drag to move"
          className="absolute cursor-move border-2 border-accentPrimary shadow-[0_0_0_1px_rgb(var(--scrim)/0.45)]"
          style={boxStyle(rect)}
          onPointerDown={(event) => startGesture(event, crop.move)}
        >
          {HANDLES.map(({ handle, className, label }) => (
            <button
              key={handle}
              type="button"
              data-testid={`crop-handle-${handle}`}
              aria-label={`Resize from the ${label} corner`}
              className={cn(
                'absolute h-6 w-6 rounded-full border-2 border-onAccent bg-accentPrimary',
                className,
              )}
              onPointerDown={(event) =>
                startGesture(event, (delta) => crop.resize(handle, delta))
              }
            />
          ))}
        </div>
      </div>

      {undoNotice ? (
        <p className="text-[12px] leading-snug text-textSecondary">{undoNotice}</p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            disabled={crop.saving}
            onClick={() => crop.suggest(preset.aspect)}
            className={cn(
              'rounded-full border border-textPrimary/15 px-3 py-1.5',
              'text-[12px] font-semibold text-textPrimary',
              'disabled:opacity-50',
            )}
          >
            {preset.label}
          </button>
        ))}

        <button
          type="button"
          disabled={crop.saving || !crop.dirty}
          onClick={crop.reset}
          className="rounded-full px-3 py-1.5 text-[12px] font-semibold text-textSecondary disabled:opacity-40"
        >
          Reset
        </button>
      </div>

      {crop.error ? (
        <p role="alert" className="text-[12px] font-semibold text-toneDanger">
          {crop.error}
        </p>
      ) : null}

      <Button
        type="button"
        disabled={crop.saving || !crop.dirty}
        onClick={async () => {
          const ok = await crop.save()
          if (ok) onDone?.()
        }}
      >
        {crop.saving ? 'Saving…' : 'Save framing'}
      </Button>
    </div>
  )
}

function pct(value: number): string {
  return `${(value * 100).toFixed(4)}%`
}

function boxStyle(rect: { x: number; y: number; w: number; h: number }) {
  return {
    left: pct(rect.x),
    top: pct(rect.y),
    width: pct(rect.w),
    height: pct(rect.h),
  }
}

function isFullFrame(rect: { x: number; y: number; w: number; h: number }): boolean {
  return rect.x <= 0 && rect.y <= 0 && rect.w >= 1 && rect.h >= 1
}

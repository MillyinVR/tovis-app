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

import {
  useCallback,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'

import RemoteImage from '@/app/_components/media/RemoteImage'
import CropFeedPreview from '@/app/_components/media/CropFeedPreview'
import type { ProMediaCrop } from '@/app/_components/media/useProMediaCrop'
import { Button } from '@/app/_components/ui'
import { focalInCropSpace } from '@/lib/media/cropRect'
import type { FocalPoint } from '@/lib/media/focalPoint'
import type { CropHandle } from '@/lib/media/cropDrag'
import { cn } from '@/lib/utils'

/** The starting frames offered, in the shapes this product actually ships. */
const PRESETS: { label: string; aspect: number }[] = [
  { label: 'Feed', aspect: 9 / 16 },
  { label: 'Portrait', aspect: 4 / 5 },
  { label: 'Square', aspect: 1 },
]

/**
 * Arrow-key step, as a fraction of the frame — and the reason the handles are
 * real `<button>`s rather than styled divs.
 *
 * 🔴 A focusable control that only answers `pointerdown` is worse than no
 * control: a keyboard user can Tab straight onto it and nothing happens, with no
 * way to tell that from a broken page. Every gesture here has a key equivalent.
 */
const NUDGE = 0.01
const NUDGE_COARSE = 0.05

/** Arrow key → normalized delta, or null for a key that is not ours to eat. */
function nudgeFor(
  event: ReactKeyboardEvent<HTMLElement>,
): { dx: number; dy: number } | null {
  const step = event.shiftKey ? NUDGE_COARSE : NUDGE
  switch (event.key) {
    case 'ArrowLeft':
      return { dx: -step, dy: 0 }
    case 'ArrowRight':
      return { dx: step, dy: 0 }
    case 'ArrowUp':
      return { dx: 0, dy: -step }
    case 'ArrowDown':
      return { dx: 0, dy: step }
    default:
      return null
  }
}

/**
 * The corner handles, INSET rather than straddling the window's corners.
 *
 * 🔴 Not a taste call — measured in a browser. Centred on the corner (a
 * `-translate-1/2` on each axis) half of every handle falls outside the frame,
 * and the frame is `overflow-hidden`: at the opening rect — the whole photo,
 * which is what every look that has never been re-framed shows — all four
 * handles rendered as quarter-circles pinched into the corners, and the clipped
 * half is not clickable either, so the 24px target was really ~12px hanging off
 * a 2px corner. Inset, the whole control is inside the clip at every position.
 */
const HANDLES: { handle: CropHandle; className: string; label: string }[] = [
  { handle: 'nw', className: 'left-0 top-0 cursor-nwse-resize', label: 'top left' },
  { handle: 'ne', className: 'right-0 top-0 cursor-nesw-resize', label: 'top right' },
  { handle: 'sw', className: 'bottom-0 left-0 cursor-nesw-resize', label: 'bottom left' },
  { handle: 'se', className: 'bottom-0 right-0 cursor-nwse-resize', label: 'bottom right' },
]

export default function CropEditor({
  crop,
  src,
  alt,
  /** Copy for the undo window, when one is open. Null renders no notice. */
  undoNotice,
  /**
   * The asset's stored focal point, in FRAME space. Only the feed preview's
   * blurred backdrop can spend it (a contain fit has no spare pixels to shift),
   * and it is remapped into crop space here against the LIVE rect.
   *
   * Optional because no caller threads a focal yet: `OwnerMediaMenu` does not
   * carry one. Null means the backdrop centres. That is a documented limitation
   * rather than a hidden one — the backdrop is blurred at σ=24 and dimmed to
   * 0.62, so an unanchored crop of it is not distinguishable, and the photo the
   * pro is actually judging ignores focal by construction. Wire it through and
   * the preview matches the slide exactly.
   */
  focal,
  onDone,
}: {
  crop: ProMediaCrop
  src: string
  alt: string
  undoNotice?: string | null
  focal?: FocalPoint | null
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

  // Remapped against the LIVE rect, so the preview's backdrop follows the drag
  // exactly as the slide's would.
  const previewFocal = focalInCropSpace(focal ?? null, rect)

  return (
    <div className="grid gap-3">
      {/* The crop frame takes the PHOTO's shape; the preview takes the SLIDE's.
          Side by side is the point — the pro is choosing between them. */}
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
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
          // 🔴 `onNaturalSize`, NOT `onLoad`. React's load handler does not fire
          // for an <img> that was already `complete` when it attached — a cached
          // photo, or one the browser finished during HTML parse. Measured in a
          // browser: on a cached image the frame kept the FALLBACK 3:4 aspect
          // while the photo (880×800) sat letterboxed inside it, so `normalize`
          // converted every drag against a box that was not the photo's — the
          // pro would have saved a rect that is not the one they drew.
          onNaturalSize={(width, height) => crop.setSourceAspect(width / height)}
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
          role="group"
          tabIndex={0}
          aria-label="Crop window — drag or use the arrow keys to move it"
          className={cn(
            'absolute cursor-move border-2 border-accentPrimary',
            'shadow-[0_0_0_1px_rgb(var(--scrim)/0.45)]',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
            'focus-visible:outline-accentPrimary',
          )}
          style={boxStyle(rect)}
          onPointerDown={(event) => startGesture(event, crop.move)}
          onKeyDown={(event) => {
            const delta = nudgeFor(event)
            if (!delta) return
            // Only once we know the key is ours: arrows we do not handle must
            // still scroll the sheet this sits in.
            event.preventDefault()
            crop.move(delta)
          }}
        >
          {HANDLES.map(({ handle, className, label }) => (
            <button
              key={handle}
              type="button"
              data-testid={`crop-handle-${handle}`}
              aria-label={`Resize from the ${label} corner — arrow keys adjust`}
              className={cn(
                'absolute h-6 w-6 rounded-full border-2 border-onAccent bg-accentPrimary',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2',
                'focus-visible:outline-accentPrimary',
                className,
              )}
              onPointerDown={(event) =>
                startGesture(event, (delta) => crop.resize(handle, delta))
              }
              onKeyDown={(event) => {
                const delta = nudgeFor(event)
                if (!delta) return
                event.preventDefault()
                // The button is inside the draggable window, so without this the
                // same arrow press would ALSO slide the whole rect.
                event.stopPropagation()
                crop.resize(handle, delta)
              }}
            />
          ))}
        </div>
      </div>

        {/* 🔴 A FIXED width in BOTH layouts, never `w-full`. The preview is a
            9:19.5 box, so a full-width one on a phone renders 361×782 — taller
            than the crop frame it is meant to annotate, pushing the presets and
            Save below the fold of the sheet this lives in. Measured at 393px
            before it shipped. 124px keeps it a glanceable panel either way. */}
        <div className="w-[124px] shrink-0">
          <CropFeedPreview src={src} cropRect={rect} focalPoint={previewFocal} />
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

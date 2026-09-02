// app/_components/media/useProMediaCrop.ts
'use client'

// The state machine behind the re-frame editor: the rect being dragged, the
// frame it may not leave, and the PUT that commits it.
//
// 🔴 It is a SEPARATE hook and a SEPARATE request from `useProMediaEdit`, for
// the same reason the route is separate from the omnibus media PATCH: the
// consent bound has to compare the incoming rect against the rect currently
// stored, so it needs a read-then-write it can serialize. Folding a re-frame
// into a caption save would let the two interleave.
//
// 🔴 The bound this hook clamps to is a HINT, not the rule. The server re-reads
// it and re-checks at execution; a 403 here is a real answer that must be shown,
// never a state the UI assumes it has already prevented.

import { useCallback, useMemo, useState } from 'react'

import { clampCropRect, suggestCropRect, type CropHandle } from '@/lib/media/cropDrag'
import { moveCropRect, resizeCropRect } from '@/lib/media/cropDrag'
import { FULL_FRAME_CROP, type CropRect } from '@/lib/media/cropRect'
import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'

export type ProMediaCropInitial = {
  /** The rect as stored, or null for an asset that has never been re-framed. */
  crop: CropRect | null
  /**
   * The frame a re-frame may not leave. The server computes the same thing from
   * the row (including the undo window); this is what the caller was told when
   * the page rendered, so the handles stop where the save would be refused.
   */
  bound: CropRect
  /**
   * Intrinsic aspect (w/h) of the STORED frame, for the "suggest" starting
   * frame.
   *
   * ⚠️ MediaAsset stores no pixel dimensions — checked, there is no width or
   * height column — so the server cannot supply this. The editor measures it
   * from the loaded image and calls {@link ProMediaCrop.setSourceAspect}. This
   * is only the value used until then; a preset pressed before the image loads
   * would otherwise fit a shape nobody has.
   */
  sourceAspect: number
  /** Normalized subject box when one is known, so the suggestion anchors on it. */
  subject?: { x: number; y: number; width: number; height: number } | null
}

export type ProMediaCrop = {
  rect: CropRect
  bound: CropRect
  /** True once the rect differs from what is stored — enables Save. */
  dirty: boolean
  saving: boolean
  error: string | null
  setError: (value: string | null) => void

  move: (delta: { dx: number; dy: number }) => void
  resize: (handle: CropHandle, delta: { dx: number; dy: number }) => void
  /** Reset to the stored rect, or to the whole bound when there is none. */
  reset: () => void
  /** Propose a frame for `targetAspect`, anchored on the subject. */
  suggest: (targetAspect: number) => void
  /** The aspect the presets fit against; measured once the image loads. */
  sourceAspect: number
  setSourceAspect: (aspect: number) => void

  /** PUTs the rect. Resolves true on success; on failure sets `error`. */
  save: () => Promise<boolean>
}

function initialRect(initial: ProMediaCropInitial): CropRect {
  // No stored rect means the whole photo — which is also the bound in that case,
  // so the editor opens showing everything the pro is allowed to keep.
  return clampCropRect(initial.crop ?? initial.bound ?? FULL_FRAME_CROP, initial.bound)
}

function sameRect(a: CropRect, b: CropRect): boolean {
  // The editor's own dirty check, not the consent rule — a rect that moved by
  // less than this is a pointer jitter, not an edit worth a request.
  const near = (p: number, q: number) => Math.abs(p - q) < 1e-6
  return near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h)
}

export function useProMediaCrop(args: {
  mediaId: string
  initial: ProMediaCropInitial
  onSaved?: (crop: CropRect) => void
}): ProMediaCrop {
  const { mediaId, initial, onSaved } = args

  const stored = useMemo(() => initialRect(initial), [initial])
  const [rect, setRect] = useState<CropRect>(stored)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sourceAspect, setSourceAspectState] = useState(initial.sourceAspect)

  const setSourceAspect = useCallback((aspect: number) => {
    // A zero or non-finite aspect would make every suggestion NaN and paint
    // nothing; an image that reports one has not really loaded.
    if (!Number.isFinite(aspect) || aspect <= 0) return
    setSourceAspectState(aspect)
  }, [])

  const bound = initial.bound

  const move = useCallback(
    (delta: { dx: number; dy: number }) =>
      setRect((current) => moveCropRect(current, delta, bound)),
    [bound],
  )

  const resize = useCallback(
    (handle: CropHandle, delta: { dx: number; dy: number }) =>
      setRect((current) => resizeCropRect(current, handle, delta, bound)),
    [bound],
  )

  const reset = useCallback(() => {
    setRect(stored)
    setError(null)
  }, [stored])

  const suggest = useCallback(
    (targetAspect: number) => {
      setRect(
        suggestCropRect({
          sourceAspect,
          targetAspect,
          subject: initial.subject ?? null,
          bound,
        }),
      )
    },
    [bound, sourceAspect, initial.subject],
  )

  const save = useCallback(async () => {
    setSaving(true)
    setError(null)

    try {
      // Clamped once more at the moment of sending: the bound can have changed
      // under a long-open editor, and a rect that pokes out earns a 403 with
      // nothing on screen to explain it.
      const toSend = clampCropRect(rect, bound)

      const res = await fetch(`/api/v1/pro/media/${mediaId}/crop`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          cropX: toSend.x,
          cropY: toSend.y,
          cropW: toSend.w,
          cropH: toSend.h,
        }),
      })

      if (!res.ok) {
        const data = await safeJson(res)
        const message =
          isRecord(data) && typeof data.error === 'string' && data.error.trim()
            ? data.error.trim()
            : 'Could not save this framing.'
        setError(message)
        return false
      }

      setRect(toSend)
      onSaved?.(toSend)
      return true
    } catch {
      setError('Could not save this framing — check your connection.')
      return false
    } finally {
      setSaving(false)
    }
  }, [bound, mediaId, onSaved, rect])

  return {
    rect,
    bound,
    dirty: !sameRect(rect, stored),
    saving,
    error,
    setError,
    move,
    resize,
    reset,
    suggest,
    sourceAspect,
    setSourceAspect,
    save,
  }
}

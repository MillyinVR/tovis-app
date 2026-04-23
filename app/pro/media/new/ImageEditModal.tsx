'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  IMAGE_CROP_PRESET_OPTIONS,
  IMAGE_UPLOAD_MAX_BYTES,
  formatBytes,
  processImageForUpload,
  readImageDimensions,
  type ImageCropPreset,
  type ImageEditState,
  type ProcessedImageResult,
} from '@/lib/media/processImageForUpload'

type Props = {
  open: boolean
  file: File | null
  onClose: () => void
  onApply: (result: ProcessedImageResult) => void
}

type DragState = {
  startX: number
  startY: number
  startOffsetX: number
  startOffsetY: number
}

const LOOKS_DEFAULT_EDIT_STATE: ImageEditState = {
  preset: 'PORTRAIT_4_5',
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function parseCropPreset(value: string): ImageCropPreset {
  switch (value) {
    case 'PORTRAIT_4_5':
      return 'PORTRAIT_4_5'
    case 'TALL_9_16':
      return 'TALL_9_16'
    case 'SQUARE_1_1':
      return 'SQUARE_1_1'
    case 'ORIGINAL':
    default:
      return 'ORIGINAL'
  }
}

function getPreviewAspectRatio(args: {
  preset: ImageCropPreset
  dimensions: { width: number; height: number } | null
}): number {
  const { preset, dimensions } = args

  if (!dimensions) return 4 / 5

  switch (preset) {
    case 'PORTRAIT_4_5':
      return 4 / 5
    case 'TALL_9_16':
      return 9 / 16
    case 'SQUARE_1_1':
      return 1
    case 'ORIGINAL':
    default:
      return dimensions.width / dimensions.height
  }
}

function ImageEditModalContent({
  open,
  file,
  onClose,
  onApply,
}: Props) {
  const [mounted, setMounted] = useState(false)
  const [edit, setEdit] = useState<ImageEditState>(LOOKS_DEFAULT_EDIT_STATE)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [dimensions, setDimensions] = useState<{
    width: number
    height: number
  } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const previewFrameRef = useRef<HTMLDivElement | null>(null)
  const dragStateRef = useRef<DragState | null>(null)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open || !file) return

    setEdit(LOOKS_DEFAULT_EDIT_STATE)
    setError(null)
    setDimensions(null)
    setDragging(false)
    dragStateRef.current = null

    const nextPreviewUrl = URL.createObjectURL(file)
    setPreviewUrl(nextPreviewUrl)

    let cancelled = false

    void (async () => {
      try {
        const nextDimensions = await readImageDimensions(file)
        if (!cancelled) {
          setDimensions(nextDimensions)
        }
      } catch {
        if (!cancelled) {
          setDimensions(null)
        }
      }
    })()

    return () => {
      cancelled = true
      URL.revokeObjectURL(nextPreviewUrl)
      setPreviewUrl(null)
    }
  }, [open, file])

  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [open])

  const previewAspectRatio = useMemo(() => {
    return getPreviewAspectRatio({
      preset: edit.preset,
      dimensions,
    })
  }, [dimensions, edit.preset])

  function stopDragging(pointerId?: number) {
    setDragging(false)
    dragStateRef.current = null

    if (previewFrameRef.current && typeof pointerId === 'number') {
      try {
        previewFrameRef.current.releasePointerCapture(pointerId)
      } catch {
        // no-op
      }
    }
  }

  function handlePreviewPointerDown(
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    if (!previewFrameRef.current) return

    dragStateRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startOffsetX: edit.offsetX,
      startOffsetY: edit.offsetY,
    }

    setDragging(true)

    try {
      previewFrameRef.current.setPointerCapture(event.pointerId)
    } catch {
      // no-op
    }
  }

  function handlePreviewPointerMove(
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    if (!dragStateRef.current || !previewFrameRef.current) return

    const rect = previewFrameRef.current.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return

    const deltaX = event.clientX - dragStateRef.current.startX
    const deltaY = event.clientY - dragStateRef.current.startY

    const nextOffsetX = clamp(
      dragStateRef.current.startOffsetX + (deltaX / rect.width) * 200,
      -100,
      100,
    )

    const nextOffsetY = clamp(
      dragStateRef.current.startOffsetY + (deltaY / rect.height) * 200,
      -100,
      100,
    )

    setEdit((prev) => ({
      ...prev,
      offsetX: nextOffsetX,
      offsetY: nextOffsetY,
    }))
  }

  function handlePreviewPointerUp(
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    stopDragging(event.pointerId)
  }

  function handlePreviewPointerCancel(
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    stopDragging(event.pointerId)
  }

  async function handleApply() {
    if (!file) return

    setSaving(true)
    setError(null)

    try {
      const result = await processImageForUpload(file, {
        maxBytes: IMAGE_UPLOAD_MAX_BYTES,
        edit,
      })
      onApply(result)
      onClose()
    } catch (nextError: unknown) {
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Could not prepare this image.',
      )
    } finally {
      setSaving(false)
    }
  }

  if (!mounted || !open || !file) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/80"
      role="dialog"
      aria-modal="true"
      aria-label="Edit image"
    >
      <div className="flex h-[100dvh] w-full items-stretch justify-center">
        <div className="flex h-full w-full max-w-3xl flex-col bg-bgSecondary text-textPrimary">
          <div className="sticky top-0 z-20 border-b border-white/10 bg-bgSecondary px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[16px] font-black text-textPrimary">
                  Adjust image
                </div>
                <div className="mt-1 text-[12px] font-semibold text-textSecondary">
                  Default fit matches the Looks feed. Drag the image to reframe it.
                </div>
              </div>

              <button
                type="button"
                onClick={onClose}
                className="shrink-0 rounded-full border border-white/10 bg-bgPrimary px-3 py-1.5 text-[12px] font-black text-textPrimary hover:bg-white/5"
              >
                Close
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            <div className="grid gap-4">
              <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
                <div className="mx-auto w-full max-w-[360px]">
                  <div
                    ref={previewFrameRef}
                    onPointerDown={handlePreviewPointerDown}
                    onPointerMove={handlePreviewPointerMove}
                    onPointerUp={handlePreviewPointerUp}
                    onPointerCancel={handlePreviewPointerCancel}
                    className="relative overflow-hidden rounded-card border border-white/10 bg-black"
                    style={{
                      aspectRatio: previewAspectRatio,
                      maxHeight: '44dvh',
                      touchAction: 'none',
                      cursor: dragging ? 'grabbing' : 'grab',
                    }}
                  >
                    {previewUrl ? (
                      <>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={previewUrl}
                          alt="Image preview"
                          className="absolute inset-0 h-full w-full object-cover"
                          style={{
                            transform: `translate(${edit.offsetX * 0.45}%, ${edit.offsetY * 0.45}%) scale(${edit.zoom})`,
                            transformOrigin: 'center center',
                            userSelect: 'none',
                            pointerEvents: 'none',
                          }}
                          draggable={false}
                          onDragStart={(event) => {
                            event.preventDefault()
                          }}
                        />
                      </>
                    ) : null}
                  </div>
                </div>

                <div className="mt-3 text-center text-[12px] font-semibold text-textSecondary">
                  Drag to reposition · use zoom for a tighter crop.
                </div>
              </div>

              <div className="rounded-card border border-white/10 bg-bgPrimary p-3">
                <div className="grid gap-1">
                  <div className="text-[12px] font-black text-textPrimary">
                    File
                  </div>
                  <div className="break-all text-[12px] text-textSecondary">
                    {file.name}
                  </div>
                  <div className="text-[12px] text-textSecondary">
                    {formatBytes(file.size)}
                    {dimensions
                      ? ` · ${dimensions.width} × ${dimensions.height}`
                      : ''}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 rounded-card border border-white/10 bg-bgPrimary p-3">
                <div className="grid gap-2">
                  <label className="text-[12px] font-black text-textPrimary">
                    Crop preset
                  </label>
                  <select
                    value={edit.preset}
                    onChange={(e) =>
                      setEdit((prev) => ({
                        ...prev,
                        preset: parseCropPreset(e.target.value),
                      }))
                    }
                    className="rounded-xl border border-white/10 bg-bgSecondary px-3 py-3 text-[13px] text-textPrimary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
                  >
                    {IMAGE_CROP_PRESET_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-[12px] font-black text-textPrimary">
                      Zoom
                    </label>
                    <div className="text-[11px] font-semibold text-textSecondary">
                      {edit.zoom.toFixed(2)}x
                    </div>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="3"
                    step="0.01"
                    value={edit.zoom}
                    onChange={(e) =>
                      setEdit((prev) => ({
                        ...prev,
                        zoom: Number(e.target.value),
                      }))
                    }
                    className="w-full"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setEdit(LOOKS_DEFAULT_EDIT_STATE)}
                  className="rounded-xl border border-white/10 bg-bgSecondary px-3 py-3 text-[13px] font-black text-textPrimary hover:bg-white/5"
                >
                  Reset image
                </button>

                {error ? (
                  <div className="rounded-xl border border-toneDanger/40 bg-toneDanger/10 px-3 py-2 text-[12px] text-toneDanger">
                    {error}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div
            className="sticky bottom-0 z-30 border-t border-white/10 bg-bgSecondary px-4 pt-3"
            style={{
              paddingBottom: 'max(16px, calc(env(safe-area-inset-bottom) + 16px))',
            }}
          >
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] font-black text-textPrimary hover:bg-white/5"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleApply}
                disabled={saving}
                className="rounded-xl border border-accentPrimary/60 bg-accentPrimary px-3 py-3 text-[13px] font-black text-bgPrimary hover:bg-accentPrimaryHover disabled:cursor-not-allowed disabled:opacity-70"
              >
                {saving ? 'Saving…' : 'Use this image'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

export default function ImageEditModal(props: Props) {
  return <ImageEditModalContent {...props} />
}
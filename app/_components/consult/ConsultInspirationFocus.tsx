'use client'

import { useCallback, useRef, useState } from 'react'
import RemoteImage from '@/app/_components/media/RemoteImage'
import type { BrandConsultFocusCopy } from '@/lib/brand/types'
import type { CropRect } from '@/lib/media/cropRect'
import { clampCropRect, resizeCropRect, type CropHandle } from '@/lib/media/cropDrag'

/** Local selection only. Confirmation hands a rectangle to the upload owner. */
export default function ConsultInspirationFocus({ src, copy, busy, onConfirm, onCancel }: {
  src: string; copy: BrandConsultFocusCopy; busy: boolean
  onConfirm: (crop: CropRect) => void; onCancel: () => void
}) {
  const frame = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<CropRect | null>(null)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const onNaturalSize = useCallback((width: number, height: number) => {
    setNatural(previous => previous?.width === width && previous.height === height ? previous : { width, height })
  }, [])
  const place = (x: number, y: number) => setRect(clampCropRect({ x: x - 0.2, y: y - 0.25, w: 0.4, h: 0.5 }))
  const edge = (handle: CropHandle, value: number, next: number) => {
    if (!rect || !Number.isFinite(next)) return
    setRect(resizeCropRect(rect, handle, handle === 'w' || handle === 'e'
      ? { dx: next - value, dy: 0 } : { dx: 0, dy: next - value }))
  }
  const button = 'rounded-lg border border-surfaceGlass/20 px-3 py-2 text-sm font-semibold text-textPrimary disabled:opacity-50'
  return <fieldset disabled={busy} className="grid min-w-0 gap-3" data-testid="consult-inspiration-focus">
    <legend className="text-sm font-semibold text-textPrimary">{copy.title}</legend>
    <p className="text-xs leading-5 text-textSecondary">{copy.instruction}</p>
    <div ref={frame} className="relative overflow-hidden rounded-lg">
      <RemoteImage src={src} alt={copy.photo} intrinsic className="block h-auto w-full"
        onNaturalSize={onNaturalSize} onError={() => setFailed(true)} />
      <button type="button" aria-label={copy.photo} disabled={!natural || failed || busy}
        className="absolute inset-0 h-full w-full focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accentPrimary"
        onClick={(event) => {
          if (event.detail === 0) { place(0.5, 0.5); return }
          const box = frame.current?.getBoundingClientRect()
          if (box && box.width > 0 && box.height > 0) place((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height)
        }} />
      {rect ? <div aria-hidden className="pointer-events-none absolute border-2 border-accentPrimary"
        style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.w * 100}%`, height: `${rect.h * 100}%`, boxShadow: '0 0 0 9999px rgb(var(--scrim) / 0.5)' }} /> : null}
    </div>
    {failed ? <p role="alert" className="text-sm text-textPrimary">{copy.loadError}</p> : null}
    {!rect && !failed ? <button type="button" className={button} disabled={!natural || busy} onClick={() => place(0.5, 0.5)}>{copy.center}</button> : null}
    {rect && natural && !failed ? <>
      {([['w', copy.left, rect.x], ['e', copy.right, rect.x + rect.w], ['n', copy.top, rect.y], ['s', copy.bottom, rect.y + rect.h]] as const).map(([handle, label, value]) =>
        <label key={handle} className="grid gap-1 text-xs text-textSecondary">{label}
          <input type="range" min={0} max={1} step={0.005} value={value} className="w-full"
            onChange={(event) => edge(handle, value, event.currentTarget.valueAsNumber)} />
        </label>)}
      <p className="text-xs text-textSecondary">{copy.preview}</p>
      <div className="relative mx-auto w-full max-w-48 overflow-hidden rounded-lg"
        style={{ aspectRatio: (natural.width * rect.w) / (natural.height * rect.h) }}>
        <RemoteImage src={src} alt={copy.preview} intrinsic cropRect={rect} className="h-full w-full" />
      </div>
      <button type="button" className={button} onClick={() => onConfirm(rect)}>{copy.confirm}</button>
    </> : null}
    <p className="text-xs leading-5 text-textSecondary">{copy.closer}</p>
    <button type="button" className={button} onClick={onCancel}>{copy.cancel}</button>
  </fieldset>
}

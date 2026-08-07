// app/_components/media/ClientMediaExportButton.tsx
//
// A CLIENT exporting/sharing a pro's media, signed with the pro's handle —
// the web counterpart of tovis-ios's ProSocialExportSheet/MediaExportIdentity
// .client path (PR MillyinVR/tovis-ios#285). Reuses the exact rendering
// pipeline ported in lib/media/socialExportGeometry.ts /
// socialExportWatermark.ts / socialExportRender.ts — no forked compositor.
//
// Signed-export only, same as iOS: no plain "save the original" option here.
// For a pro's portfolio/Looks/review work a plain save would hand out their
// professional photography with no attribution at all, defeating the whole
// point of a discovery channel — one rule, not a case-by-case judgment call.
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { useBrand } from '@/lib/brand/BrandProvider'
import { cn } from '@/lib/utils'
import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'
import { zClass } from '@/lib/zIndex'
import {
  SOCIAL_EXPORT_FORMATS,
  formatPlatformLabel,
  formatShortLabel,
  type SocialExportFormat,
} from '@/lib/media/socialExportGeometry'
import { clientExportWatermark, isEmptyWatermark } from '@/lib/media/socialExportWatermark'
import { renderPairExport, renderSingleExport } from '@/lib/media/socialExportRender'

export type ClientExportMedia =
  | { kind: 'single'; url: string }
  | { kind: 'pair'; beforeUrl: string; afterUrl: string }

type Props = {
  professionalId: string
  media: ClientExportMedia
  variant?: 'icon' | 'pill'
  className?: string
}

type ClientExportIdentity = {
  handle: string | null
  businessName: string | null
  enabled: boolean
  dropsPlatformMark: boolean
}

type IdentityState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'loaded'; identity: ClientExportIdentity }
  | { status: 'error' }

/** Defensive parse — the wire shape is `ProPublicProfileDto` but this file
 * only needs a few fields, and a malformed/older response should degrade to
 * "sharing unavailable" rather than throw. Exported for its own test. */
export function parseIdentity(data: unknown): ClientExportIdentity | null {
  if (!isRecord(data) || !isRecord(data.professional)) return null
  const header = data.professional.header
  if (!isRecord(header)) return null
  const clientExport = header.clientExport
  if (!isRecord(clientExport)) return null

  return {
    handle: pickString(header.handle) ?? null,
    businessName: pickString(header.businessName) ?? null,
    enabled: clientExport.enabled === true,
    dropsPlatformMark: clientExport.dropsPlatformMark !== false,
  }
}

function canShareFiles(files: File[]): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false
  if (typeof navigator.canShare !== 'function') return true
  try {
    return navigator.canShare({ files })
  } catch {
    return false
  }
}

export default function ClientMediaExportButton({
  professionalId,
  media,
  variant = 'icon',
  className = '',
}: Props) {
  const { brand } = useBrand()
  const [open, setOpen] = useState(false)
  const [identityState, setIdentityState] = useState<IdentityState>({ status: 'idle' })
  const [format, setFormat] = useState<SocialExportFormat>('instagram45')
  const [preview, setPreview] = useState<string | null>(null)
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const [actionStatus, setActionStatus] = useState<string | null>(null)

  // `fetchStarted` (not `identityState.status`) gates this — putting the
  // state we SET in here into our own dependency array was the bug: setting
  // it changes the dependency, which reruns the effect, which runs THIS
  // invocation's cleanup FIRST and marks its own in-flight fetch `cancelled`
  // before the response ever lands, stranding the UI on "Loading…" forever.
  const fetchStarted = useRef(false)

  useEffect(() => {
    if (!open || fetchStarted.current) return
    fetchStarted.current = true
    let cancelled = false
    setIdentityState({ status: 'loading' })
    void (async () => {
      try {
        const res = await fetch(`/api/v1/professionals/${encodeURIComponent(professionalId)}`, {
          cache: 'no-store',
        })
        const data = await res.json().catch(() => null)
        const identity = res.ok ? parseIdentity(data) : null
        if (cancelled) return
        setIdentityState(identity ? { status: 'loaded', identity } : { status: 'error' })
      } catch {
        if (!cancelled) setIdentityState({ status: 'error' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, professionalId])

  const watermark = useMemo(() => {
    if (identityState.status !== 'loaded') return null
    return clientExportWatermark({
      handle: identityState.identity.handle,
      businessName: identityState.identity.businessName,
      dropsPlatformMark: identityState.identity.dropsPlatformMark,
      platformMark: brand.displayName,
    })
  }, [identityState, brand.displayName])

  // Re-render the preview whenever the format or the loaded identity changes.
  useEffect(() => {
    if (!open || !watermark) return
    let cancelled = false
    setRenderError(null)
    setRendering(true)
    void (async () => {
      try {
        const blob =
          media.kind === 'pair'
            ? await renderPairExport({
                format,
                beforeUrl: media.beforeUrl,
                afterUrl: media.afterUrl,
                watermark,
              })
            : await renderSingleExport({ format, imageUrl: media.url, watermark })
        if (cancelled) return
        setPreview((old) => {
          if (old) URL.revokeObjectURL(old)
          return URL.createObjectURL(blob)
        })
      } catch {
        if (!cancelled) setRenderError('Couldn’t build that export. Try again.')
      } finally {
        if (!cancelled) setRendering(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `media` is a stable prop identity per mount
  }, [open, watermark, format])

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview)
    }
  }, [preview])

  function close() {
    setOpen(false)
    setActionStatus(null)
    setRenderError(null)
  }

  async function currentBlob(): Promise<Blob | null> {
    if (!preview) return null
    const res = await fetch(preview)
    return res.blob()
  }

  async function share() {
    const blob = await currentBlob()
    if (!blob) return
    const file = new File([blob], `${brand.displayName.toLowerCase()}-export.jpg`, {
      type: 'image/jpeg',
    })
    try {
      if (canShareFiles([file])) {
        await navigator.share({ files: [file], title: brand.displayName })
        setActionStatus('Shared')
        return
      }
      download(blob)
      setActionStatus('Downloaded')
    } catch (e) {
      // AbortError = the viewer cancelled the OS share sheet — not a failure.
      if (e instanceof Error && e.name === 'AbortError') return
      setActionStatus('Couldn’t share — try downloading instead.')
    }
  }

  function download(blob: Blob) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${brand.displayName.toLowerCase()}-export.jpg`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  async function downloadOnly() {
    const blob = await currentBlob()
    if (!blob) return
    download(blob)
    setActionStatus('Downloaded')
  }

  const noSignatureMessage =
    'This pro hasn’t set a handle yet, so their exports go unsigned.'

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Share photo"
        aria-label="Share photo"
        className={cn(buttonClassNameForVariant(variant), className)}
      >
        <span aria-hidden="true">⇪</span>
        {variant === 'pill' ? <span>Share photo</span> : null}
      </button>

      {open ? (
        <div className={cn('fixed inset-0 bg-black/60', zClass.modal)} onClick={close}>
          <div
            className={cn(
              'mx-auto mt-10 w-full max-w-[420px] overflow-hidden rounded-[18px]',
              'border border-white/12 bg-bgPrimary/90 backdrop-blur-2xl',
              'shadow-[0_22px_90px_rgba(0,0,0,0.70)]',
              'grid grid-rows-[auto_1fr_auto]',
            )}
            style={{ maxHeight: 'calc(100dvh - 60px)' }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Share photo"
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="text-[13px] font-black text-textPrimary">Share photo</div>
              <button
                type="button"
                onClick={close}
                className="grid h-9 w-9 place-items-center rounded-full border border-white/12 bg-bgPrimary/30 text-[14px] font-black text-white hover:bg-white/10"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="overflow-y-auto p-4">
              {identityState.status === 'loading' || identityState.status === 'idle' ? (
                <div className="grid h-40 place-items-center text-[12px] font-semibold text-textSecondary">
                  Loading…
                </div>
              ) : identityState.status === 'error' ? (
                <div className="rounded-[14px] border border-white/10 bg-black/20 p-3 text-[12px] font-semibold text-toneDanger">
                  Couldn’t load sharing settings for this pro. Try again.
                </div>
              ) : !identityState.identity.enabled ? (
                <div className="rounded-[14px] border border-white/10 bg-black/20 p-3 text-[12px] font-semibold text-textSecondary">
                  This pro has turned off sharing.
                </div>
              ) : (
                <div className="grid gap-4">
                  <div className="relative overflow-hidden rounded-[14px] bg-bgSecondary" style={{ aspectRatio: formatShortLabelToAspect(format) }}>
                    {preview ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a client-rendered canvas Blob, not a remote asset RemoteImage can optimize
                      <img src={preview} alt="Export preview" className="h-full w-full object-contain" />
                    ) : (
                      <div className="grid h-full place-items-center">
                        <span className="text-[11px] font-semibold text-textSecondary">
                          {rendering ? 'Rendering…' : ' '}
                        </span>
                      </div>
                    )}
                    {rendering && preview ? <div className="absolute inset-0 bg-black/15" /> : null}
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    {SOCIAL_EXPORT_FORMATS.map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFormat(f)}
                        className={cn(
                          'rounded-[14px] border px-3 py-2 text-left transition',
                          f === format
                            ? 'border-accentPrimary/40 bg-accentPrimary/15'
                            : 'border-white/10 bg-bgPrimary/25 hover:bg-white/5',
                        )}
                      >
                        <div className="text-[13px] font-black text-textPrimary">{formatShortLabel(f)}</div>
                        <div className="text-[11px] font-semibold text-textSecondary">{formatPlatformLabel(f)}</div>
                      </button>
                    ))}
                  </div>

                  <div className="text-[11px] font-mono uppercase tracking-wide text-textSecondary">Signed</div>
                  {watermark && !isEmptyWatermark(watermark) ? (
                    <div className="text-[14px] font-semibold text-textPrimary">
                      {watermark.showsPlatformMark
                        ? `${watermark.signature} · ${watermark.platformMark.toUpperCase()}`
                        : watermark.signature}
                    </div>
                  ) : (
                    <div className="text-[12px] text-textSecondary">{noSignatureMessage}</div>
                  )}

                  {renderError ? (
                    <div className="text-[12px] font-semibold text-toneDanger">{renderError}</div>
                  ) : null}
                  {actionStatus ? (
                    <div aria-live="polite" className="text-[12px] font-semibold text-textSecondary">
                      {actionStatus}
                    </div>
                  ) : null}
                </div>
              )}
            </div>

            {identityState.status === 'loaded' && identityState.identity.enabled ? (
              <div className="flex gap-2 border-t border-white/10 bg-bgPrimary/85 px-4 py-3">
                <button
                  type="button"
                  onClick={() => void share()}
                  disabled={rendering || !preview}
                  className={cn(
                    'flex-1 rounded-[14px] px-3 py-3 text-[13px] font-black transition',
                    rendering || !preview
                      ? 'cursor-not-allowed border border-white/10 bg-bgPrimary text-textSecondary opacity-70'
                      : 'bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
                  )}
                >
                  Share
                </button>
                <button
                  type="button"
                  onClick={() => void downloadOnly()}
                  disabled={rendering || !preview}
                  className={cn(
                    'flex-1 rounded-[14px] border px-3 py-3 text-[13px] font-black transition',
                    rendering || !preview
                      ? 'cursor-not-allowed border-white/10 text-textSecondary opacity-70'
                      : 'border-accentPrimary/40 text-accentPrimary hover:bg-white/5',
                  )}
                >
                  Download
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  )
}

function formatShortLabelToAspect(format: SocialExportFormat): string {
  return format === 'feed916' ? '9 / 16' : '4 / 5'
}

function buttonClassNameForVariant(variant: 'icon' | 'pill'): string {
  if (variant === 'icon') {
    return [
      'brand-button-ghost brand-focus tap-target',
      'inline-flex h-10 w-10 items-center justify-center rounded-full',
      'text-[14px] font-black transition',
    ].join(' ')
  }
  return [
    'brand-button-ghost brand-focus',
    'inline-flex items-center gap-2 rounded-full px-3 py-2',
    'text-[12px] font-black transition',
  ].join(' ')
}

'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabaseBrowser } from '@/lib/supabaseBrowser'
import {
  LookPostVisibility,
  MediaType,
  MediaVisibility,
} from '@prisma/client'
import { isRecord } from '@/lib/guards'
import { pickStringOrEmpty } from '@/lib/pick'
import { safeJsonRecord, readErrorMessage } from '@/lib/http'

type ProService = { id: string; name: string }

const CAPTION_MAX = 300
const MAX_IMAGE_MB = 25
const MAX_VIDEO_MB = 200
const PRICE_MAX_LENGTH = 20

function bytesFromMb(mb: number) {
  return mb * 1024 * 1024
}

function computeVisibility(
  isEligibleForLooks: boolean,
  isFeaturedInPortfolio: boolean,
): MediaVisibility {
  return isEligibleForLooks || isFeaturedInPortfolio
    ? MediaVisibility.PUBLIC
    : MediaVisibility.PRO_CLIENT
}

function guessMediaType(file: File): MediaType {
  return (file.type || '').toLowerCase().startsWith('video/')
    ? MediaType.VIDEO
    : MediaType.IMAGE
}

function coerceProService(x: unknown): ProService | null {
  if (!isRecord(x)) return null
  const id = pickStringOrEmpty(x.id)
  const nameRaw = pickStringOrEmpty(x.name)
  if (!id) return null
  return { id, name: nameRaw || 'Service' }
}

function parseServicesPayload(data: unknown): ProService[] {
  if (!isRecord(data)) return []
  const raw = data.services
  if (!Array.isArray(raw)) return []
  return raw.map(coerceProService).filter(Boolean) as ProService[]
}

type UploadInit = {
  bucket: string
  path: string
  token: string
  publicUrl: string | null
}

function parseUploadInit(data: unknown): UploadInit | null {
  if (!isRecord(data)) return null
  const bucket = pickStringOrEmpty(data.bucket)
  const path = pickStringOrEmpty(data.path)
  const token = pickStringOrEmpty(data.token)
  const publicUrl = (() => {
    const s = pickStringOrEmpty(data.publicUrl)
    return s || null
  })()

  if (!bucket || !path || !token) return null
  return { bucket, path, token, publicUrl }
}

function normalizeMoneyInput(value: string): string {
  return value.replace(/[^\d.]/g, '').slice(0, PRICE_MAX_LENGTH)
}

function isValidPriceString(value: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(value)
}

export default function NewMediaPostForm() {
  const router = useRouter()

  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [mediaType, setMediaType] = useState<MediaType>(MediaType.IMAGE)

  const [services, setServices] = useState<ProService[]>([])
  const [serviceIds, setServiceIds] = useState<string[]>([])
  const [primaryServiceId, setPrimaryServiceId] = useState<string | null>(null)

  const [isEligibleForLooks, setIsEligibleForLooks] = useState(false)
  const [isFeaturedInPortfolio, setIsFeaturedInPortfolio] = useState(true)
  const [lookVisibility, setLookVisibility] = useState<LookPostVisibility>(
    LookPostVisibility.PUBLIC,
  )
  const [priceStartingAt, setPriceStartingAt] = useState('')

  const [visibility, setVisibility] = useState<MediaVisibility>(
    MediaVisibility.PUBLIC,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isPublicSelectionValid = isEligibleForLooks || isFeaturedInPortfolio
  const looksPublishEnabled = isEligibleForLooks

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        const res = await fetch('/api/pro/services', { cache: 'no-store' })
        const data = await safeJsonRecord(res)

        if (!res.ok) {
          if (!cancelled) setServices([])
          return
        }

        const list = parseServicesPayload(data)
        if (!cancelled) setServices(list)
      } catch {
        if (!cancelled) setServices([])
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setVisibility(
      computeVisibility(isEligibleForLooks, isFeaturedInPortfolio),
    )
  }, [isEligibleForLooks, isFeaturedInPortfolio])

  useEffect(() => {
    if (serviceIds.length === 0) {
      setPrimaryServiceId(null)
      return
    }

    if (serviceIds.length === 1) {
      setPrimaryServiceId(serviceIds[0])
      return
    }

    if (!primaryServiceId || !serviceIds.includes(primaryServiceId)) {
      setPrimaryServiceId(null)
    }
  }, [primaryServiceId, serviceIds])

  const maxBytes = useMemo(() => {
    return mediaType === MediaType.VIDEO
      ? bytesFromMb(MAX_VIDEO_MB)
      : bytesFromMb(MAX_IMAGE_MB)
  }, [mediaType])

  const fileError = useMemo(() => {
    if (!file) return null
    if (file.size <= 0) return 'That file looks empty.'
    if (file.size > maxBytes) {
      const mb = (file.size / (1024 * 1024)).toFixed(1)
      const limit =
        mediaType === MediaType.VIDEO ? MAX_VIDEO_MB : MAX_IMAGE_MB
      return `That file is ${mb}MB — over the ${limit}MB limit.`
    }
    return null
  }, [file, maxBytes, mediaType])

  const trimmedPrice = useMemo(() => priceStartingAt.trim(), [priceStartingAt])

  const priceError = useMemo(() => {
    if (!trimmedPrice) return null
    if (!isValidPriceString(trimmedPrice)) {
      return 'Starting price must be a valid amount with up to 2 decimals.'
    }
    return null
  }, [trimmedPrice])

  const needsPrimaryService =
    isEligibleForLooks && serviceIds.length > 1 && !primaryServiceId

  const canSubmit = useMemo(() => {
    return (
      !!file &&
      !fileError &&
      !priceError &&
      serviceIds.length >= 1 &&
      isPublicSelectionValid &&
      !needsPrimaryService &&
      !saving
    )
  }, [
    file,
    fileError,
    priceError,
    serviceIds.length,
    isPublicSelectionValid,
    needsPrimaryService,
    saving,
  ])

  function toggleService(id: string) {
    setServiceIds((prev) =>
      prev.includes(id)
        ? prev.filter((value) => value !== id)
        : [...prev, id],
    )
  }

  async function uploadSelectedFile() {
    if (!file) throw new Error('Select a file')

    if (!isPublicSelectionValid) {
      throw new Error('Select “Show in Looks” or “Show in Portfolio”.')
    }

    const kind = isEligibleForLooks ? 'LOOKS_PUBLIC' : 'PORTFOLIO_PUBLIC'

    const res = await fetch('/api/pro/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        contentType: file.type || 'application/octet-stream',
        size: file.size,
      }),
    })

    const data = await safeJsonRecord(res)
    if (!res.ok) {
      throw new Error(
        readErrorMessage(data) ?? `Upload init failed (${res.status})`,
      )
    }

    const init = parseUploadInit(data)
    if (!init) {
      throw new Error(
        'Upload init failed (missing bucket/path/token).',
      )
    }

    const { error: uploadError } =
      await supabaseBrowser.storage
        .from(init.bucket)
        .uploadToSignedUrl(init.path, init.token, file, {
          contentType: file.type || undefined,
          upsert: false,
        })

    if (uploadError) {
      throw new Error(uploadError.message || 'Upload failed')
    }

    return {
      storageBucket: init.bucket,
      storagePath: init.path,
      publicUrl: init.publicUrl,
    }
  }

  async function submit() {
    if (!canSubmit) return

    setSaving(true)
    setError(null)

    try {
      if (needsPrimaryService) {
        throw new Error(
          'Choose a primary service for Looks when multiple services are selected.',
        )
      }

      if (priceError) {
        throw new Error(priceError)
      }

      const uploaded = await uploadSelectedFile()

      const res = await fetch('/api/pro/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bucket: uploaded.storageBucket,
          path: uploaded.storagePath,
          publicUrl: uploaded.publicUrl ?? undefined,

          caption: caption.trim().slice(0, CAPTION_MAX) || undefined,
          mediaType,
          isFeaturedInPortfolio,
          isEligibleForLooks,
          publishToLooks: looksPublishEnabled,
          serviceIds,
          primaryServiceId:
            isEligibleForLooks && primaryServiceId
              ? primaryServiceId
              : undefined,
          lookVisibility:
            isEligibleForLooks ? lookVisibility : undefined,
          priceStartingAt: trimmedPrice || undefined,
        }),
      })

      const data = await safeJsonRecord(res)
      if (!res.ok) {
        throw new Error(
          readErrorMessage(data) ?? `Request failed (${res.status})`,
        )
      }

      router.push('/pro/media')
      router.refresh()
    } catch (e: unknown) {
      setError(
        e instanceof Error ? e.message : 'Failed to create post.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
      <div className="grid gap-4">
        <div className="grid gap-2">
          <label className="text-[12px] font-black text-textPrimary">
            Upload file
          </label>
          <input
            type="file"
            accept="image/*,video/*"
            onChange={(e) => {
              const selectedFile = e.target.files?.[0] || null
              setFile(selectedFile)
              if (selectedFile) {
                setMediaType(guessMediaType(selectedFile))
              }
            }}
            className="block w-full text-[13px] text-textPrimary"
          />
          <div className="text-[11px] text-textSecondary">
            Public posts (Looks/Portfolio) must live in the public bucket to
            render in the app.
          </div>
          {fileError ? (
            <div className="text-[12px] text-toneDanger">
              {fileError}
            </div>
          ) : null}
        </div>

        <div className="grid gap-2">
          <label className="text-[12px] font-black text-textPrimary">
            Caption
          </label>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="What did we do here? Hair witchcraft? Nail sorcery?"
            rows={3}
            maxLength={CAPTION_MAX}
            className="rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
          />
          <div className="text-[11px] text-textSecondary">
            {caption.trim().length}/{CAPTION_MAX}
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <select
            value={mediaType}
            onChange={(e) => {
              const value = e.target.value
              setMediaType(
                value === MediaType.VIDEO
                  ? MediaType.VIDEO
                  : MediaType.IMAGE,
              )
            }}
            className="rounded-xl border border-white/10 bg-bgPrimary px-3 py-3 text-[13px] text-textPrimary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
          >
            <option value={MediaType.IMAGE}>Image</option>
            <option value={MediaType.VIDEO}>Video</option>
          </select>

          <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-bgPrimary px-3 py-3">
            <span className="text-[12px] font-black text-textSecondary">
              Media visibility
            </span>
            <span className="text-[12px] font-black text-textPrimary">
              {visibility}
            </span>
          </div>

          <label className="flex items-center gap-2 text-[12px] font-black text-textPrimary">
            <input
              type="checkbox"
              checked={isEligibleForLooks}
              onChange={(e) => setIsEligibleForLooks(e.target.checked)}
              className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
            />
            Show in Looks
          </label>

          <label className="flex items-center gap-2 text-[12px] font-black text-textPrimary">
            <input
              type="checkbox"
              checked={isFeaturedInPortfolio}
              onChange={(e) => setIsFeaturedInPortfolio(e.target.checked)}
              className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
            />
            Show in Portfolio
          </label>
        </div>

        <div className="grid gap-2">
          <div className="text-[12px] font-black text-textPrimary">
            Tag services{' '}
            <span className="font-extrabold text-textSecondary">
              (pick at least 1)
            </span>
          </div>

          {services.length === 0 ? (
            <div className="text-[12px] text-textSecondary">
              No services found. Add services first.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {services.map((service) => {
                const active = serviceIds.includes(service.id)
                return (
                  <button
                    key={service.id}
                    type="button"
                    onClick={() => toggleService(service.id)}
                    className={[
                      'rounded-full border px-3 py-2 text-[12px] font-black transition',
                      active
                        ? 'border-white/10 bg-textPrimary text-bgPrimary'
                        : 'border-white/10 bg-bgPrimary text-textPrimary hover:border-white/20',
                    ].join(' ')}
                  >
                    {service.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {isEligibleForLooks ? (
          <div className="grid gap-3 rounded-xl border border-white/10 bg-bgPrimary p-3">
            <div className="text-[12px] font-black text-textPrimary">
              Looks settings
            </div>

            <div className="grid gap-2">
              <label className="text-[12px] font-black text-textPrimary">
                Primary service
              </label>
              <select
                value={primaryServiceId ?? ''}
                onChange={(e) =>
                  setPrimaryServiceId(
                    e.target.value ? e.target.value : null,
                  )
                }
                disabled={serviceIds.length === 0}
                className="rounded-xl border border-white/10 bg-bgSecondary px-3 py-3 text-[13px] text-textPrimary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40 disabled:opacity-60"
              >
                <option value="">
                  {serviceIds.length <= 1
                    ? 'Primary service will be selected automatically'
                    : 'Choose the primary service for Looks'}
                </option>
                {services
                  .filter((service) => serviceIds.includes(service.id))
                  .map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.name}
                    </option>
                  ))}
              </select>
              {needsPrimaryService ? (
                <div className="text-[12px] text-toneDanger">
                  Choose one primary service for Looks when multiple
                  services are selected.
                </div>
              ) : null}
            </div>

            <div className="grid gap-2 md:grid-cols-2">
              <div className="grid gap-2">
                <label className="text-[12px] font-black text-textPrimary">
                  Looks visibility
                </label>
                <select
                  value={lookVisibility}
                  onChange={(e) => {
                    const value = e.target.value
                    setLookVisibility(
                      value === LookPostVisibility.FOLLOWERS_ONLY
                        ? LookPostVisibility.FOLLOWERS_ONLY
                        : value === LookPostVisibility.UNLISTED
                          ? LookPostVisibility.UNLISTED
                          : LookPostVisibility.PUBLIC,
                    )
                  }}
                  className="rounded-xl border border-white/10 bg-bgSecondary px-3 py-3 text-[13px] text-textPrimary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
                >
                  <option value={LookPostVisibility.PUBLIC}>Public</option>
                  <option value={LookPostVisibility.FOLLOWERS_ONLY}>
                    Followers only
                  </option>
                  <option value={LookPostVisibility.UNLISTED}>
                    Unlisted
                  </option>
                </select>
              </div>

              <div className="grid gap-2">
                <label className="text-[12px] font-black text-textPrimary">
                  Starting price (optional)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={priceStartingAt}
                  onChange={(e) =>
                    setPriceStartingAt(
                      normalizeMoneyInput(e.target.value),
                    )
                  }
                  placeholder="85.00"
                  className="rounded-xl border border-white/10 bg-bgSecondary px-3 py-3 text-[13px] text-textPrimary placeholder:text-textSecondary focus:outline-none focus:ring-2 focus:ring-accentPrimary/40"
                />
                {priceError ? (
                  <div className="text-[12px] text-toneDanger">
                    {priceError}
                  </div>
                ) : (
                  <div className="text-[11px] text-textSecondary">
                    If Looks is enabled, this will publish to Looks now.
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : null}

        {!isPublicSelectionValid ? (
          <div className="rounded-xl border border-toneDanger/40 bg-toneDanger/10 px-3 py-2 text-[12px] text-toneDanger">
            Select <strong>Looks</strong> or <strong>Portfolio</strong> to
            publish this post.
          </div>
        ) : null}

        {error ? (
          <div className="text-[12px] text-toneDanger">{error}</div>
        ) : null}

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit}
          className={[
            'rounded-card border px-4 py-3 text-[13px] font-black transition',
            canSubmit
              ? 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover'
              : 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70',
          ].join(' ')}
        >
          {saving ? 'Posting…' : 'Post'}
        </button>
      </div>
    </div>
  )
}
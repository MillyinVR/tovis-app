'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import ImageEditModal from './ImageEditModal'
import {
  DEFAULT_IMAGE_EDIT_STATE,
  IMAGE_UPLOAD_MAX_BYTES,
  VIDEO_UPLOAD_MAX_BYTES,
  formatBytes,
  processImageForUpload,
  type ProcessedImageResult,
} from '@/lib/media/processImageForUpload'

type ProService = { id: string; name: string }

type UploadInit = {
  bucket: string
  path: string
  token: string
  publicUrl: string | null
}

const CAPTION_MAX = 300
const PRICE_MAX_LENGTH = 20

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

function coerceProService(value: unknown): ProService | null {
  if (!isRecord(value)) return null

  const id = pickStringOrEmpty(value.id)
  const name = pickStringOrEmpty(value.name)

  if (!id) return null

  return {
    id,
    name: name || 'Service',
  }
}

function parseServicesPayload(data: unknown): ProService[] {
  if (!isRecord(data)) return []

  const rawServices = data.services
  if (!Array.isArray(rawServices)) return []

  return rawServices
    .map(coerceProService)
    .filter((service): service is ProService => service !== null)
}

function parseUploadInit(data: unknown): UploadInit | null {
  if (!isRecord(data)) return null

  const bucket = pickStringOrEmpty(data.bucket)
  const path = pickStringOrEmpty(data.path)
  const token = pickStringOrEmpty(data.token)
  const publicUrl = (() => {
    const value = pickStringOrEmpty(data.publicUrl)
    return value || null
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

function getVideoFileError(file: File | null): string | null {
  if (!file) return 'Select an image or video to post.'
  if (file.size <= 0) return 'That file looks empty.'

  if (file.size > VIDEO_UPLOAD_MAX_BYTES) {
    return `That file is ${formatBytes(file.size)}. The video limit is ${formatBytes(VIDEO_UPLOAD_MAX_BYTES)}.`
  }

  return null
}

function getImageFileError(args: {
  file: File | null
  processedImage: ProcessedImageResult | null
  preparing: boolean
}): string | null {
  if (!args.file) return 'Select an image or video to post.'
  if (args.file.size <= 0) return 'That file looks empty.'
  if (args.preparing) return 'Preparing image for upload…'
  if (!args.processedImage) return 'Image is not ready yet.'

  if (args.processedImage.processedBytes > IMAGE_UPLOAD_MAX_BYTES) {
    return `The optimized image is still ${formatBytes(args.processedImage.processedBytes)}. Crop it tighter or choose another image.`
  }

  return null
}

function getPriceError(value: string): string | null {
  if (!value) return null

  if (!isValidPriceString(value)) {
    return 'Starting price must be a valid amount with up to 2 decimals.'
  }

  return null
}

function getBlockingReasons(args: {
  fileError: string | null
  servicesLoading: boolean
  servicesLoadError: string | null
  services: ProService[]
  serviceIds: string[]
  isPublicSelectionValid: boolean
  needsPrimaryService: boolean
  priceError: string | null
}): string[] {
  const reasons: string[] = []

  if (args.fileError) {
    reasons.push(args.fileError)
  }

  if (args.servicesLoading) {
    reasons.push('Services are still loading.')
  } else if (args.servicesLoadError) {
    reasons.push(args.servicesLoadError)
  } else if (args.services.length === 0) {
    reasons.push('No services found. Add at least one service before posting.')
  } else if (args.serviceIds.length === 0) {
    reasons.push('Tag at least one service.')
  }

  if (!args.isPublicSelectionValid) {
    reasons.push('Select “Show in Looks” or “Show in Portfolio”.')
  }

  if (args.needsPrimaryService) {
    reasons.push(
      'Choose one primary service for Looks when multiple services are selected.',
    )
  }

  if (args.priceError) {
    reasons.push(args.priceError)
  }

  return reasons
}

export default function NewMediaPostForm() {
  const router = useRouter()

  const [file, setFile] = useState<File | null>(null)
  const [caption, setCaption] = useState('')
  const [mediaType, setMediaType] = useState<MediaType>(MediaType.IMAGE)

  const [services, setServices] = useState<ProService[]>([])
  const [servicesLoading, setServicesLoading] = useState(true)
  const [servicesLoadError, setServicesLoadError] = useState<string | null>(null)

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

  const [processedImage, setProcessedImage] = useState<ProcessedImageResult | null>(null)
  const [imagePreparing, setImagePreparing] = useState(false)
  const [imageEditorOpen, setImageEditorOpen] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [uploadPreviewUrl, setUploadPreviewUrl] = useState<string | null>(null)

  const prepareRequestIdRef = useRef(0)

  const isPublicSelectionValid = isEligibleForLooks || isFeaturedInPortfolio
  const looksPublishEnabled = isEligibleForLooks

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      setServicesLoading(true)
      setServicesLoadError(null)

      try {
        const res = await fetch('/api/pro/services', { cache: 'no-store' })
        const data = await safeJsonRecord(res)

        if (!res.ok) {
          if (!cancelled) {
            setServices([])
            setServicesLoadError(
              readErrorMessage(data) ?? 'Could not load services.',
            )
          }
          return
        }

        const list = parseServicesPayload(data)

        if (!cancelled) {
          setServices(list)

          if (list.length === 0) {
            setServicesLoadError(
              'No services found. Add at least one service before posting.',
            )
          }
        }
      } catch {
        if (!cancelled) {
          setServices([])
          setServicesLoadError('Could not load services.')
        }
      } finally {
        if (!cancelled) {
          setServicesLoading(false)
        }
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

  const uploadCandidateFile = useMemo(() => {
    if (mediaType === MediaType.IMAGE) {
      return processedImage?.file ?? null
    }

    return file
  }, [file, mediaType, processedImage])

  useEffect(() => {
    if (!uploadCandidateFile) {
      setUploadPreviewUrl(null)
      return
    }

    if (mediaType !== MediaType.IMAGE) {
      setUploadPreviewUrl(null)
      return
    }

    const url = URL.createObjectURL(uploadCandidateFile)
    setUploadPreviewUrl(url)

    return () => {
      URL.revokeObjectURL(url)
    }
  }, [uploadCandidateFile, mediaType])

  const trimmedPrice = useMemo(() => priceStartingAt.trim(), [priceStartingAt])

  const priceError = useMemo(
    () => getPriceError(trimmedPrice),
    [trimmedPrice],
  )

  const needsPrimaryService = useMemo(
    () =>
      isEligibleForLooks &&
      serviceIds.length > 1 &&
      !primaryServiceId,
    [isEligibleForLooks, primaryServiceId, serviceIds.length],
  )

  const fileError = useMemo(() => {
    if (mediaType === MediaType.IMAGE) {
      return getImageFileError({
        file,
        processedImage,
        preparing: imagePreparing,
      })
    }

    return getVideoFileError(file)
  }, [file, imagePreparing, mediaType, processedImage])

  const blockingReasons = useMemo(
    () =>
      getBlockingReasons({
        fileError,
        servicesLoading,
        servicesLoadError,
        services,
        serviceIds,
        isPublicSelectionValid,
        needsPrimaryService,
        priceError,
      }),
    [
      fileError,
      servicesLoading,
      servicesLoadError,
      services,
      serviceIds,
      isPublicSelectionValid,
      needsPrimaryService,
      priceError,
    ],
  )

  const canSubmit = blockingReasons.length === 0 && !saving

  const primaryBlockingReason = blockingReasons[0] ?? null

  const showBlockingBox = Boolean(
    file ||
      caption.trim() ||
      trimmedPrice ||
      serviceIds.length > 0 ||
      error ||
      isEligibleForLooks ||
      !isFeaturedInPortfolio,
  )

  const imageStatusCopy = useMemo(() => {
    if (!file || mediaType !== MediaType.IMAGE) return null
    if (imagePreparing) return 'Optimizing image for upload…'
    if (!processedImage) return null

    if (processedImage.processedBytes < file.size) {
      return `Upload ready · optimized from ${formatBytes(file.size)} to ${formatBytes(processedImage.processedBytes)}.`
    }

    return `Upload ready · ${formatBytes(processedImage.processedBytes)}.`
  }, [file, imagePreparing, mediaType, processedImage])

  const prepareSelectedImage = useCallback(async (selectedFile: File) => {
    const requestId = ++prepareRequestIdRef.current

    setImagePreparing(true)
    setProcessedImage(null)

    try {
      const result = await processImageForUpload(selectedFile, {
        maxBytes: IMAGE_UPLOAD_MAX_BYTES,
        edit: DEFAULT_IMAGE_EDIT_STATE,
      })

      if (prepareRequestIdRef.current !== requestId) return

      setProcessedImage(result)
    } catch (nextError: unknown) {
      if (prepareRequestIdRef.current !== requestId) return

      setProcessedImage(null)
      setError(
        nextError instanceof Error
          ? nextError.message
          : 'Could not prepare this image.',
      )
    } finally {
      if (prepareRequestIdRef.current === requestId) {
        setImagePreparing(false)
      }
    }
  }, [])

  async function handleFileChange(selectedFile: File | null) {
    setFile(selectedFile)
    setProcessedImage(null)
    setImageEditorOpen(false)
    setError(null)

    if (!selectedFile) {
      setMediaType(MediaType.IMAGE)
      setImagePreparing(false)
      return
    }

    const guessedType = guessMediaType(selectedFile)
    setMediaType(guessedType)

    if (guessedType === MediaType.IMAGE) {
      await prepareSelectedImage(selectedFile)
      return
    }

    setImagePreparing(false)
  }

  function toggleService(id: string) {
    setServiceIds((prev) =>
      prev.includes(id)
        ? prev.filter((value) => value !== id)
        : [...prev, id],
    )
    setError(null)
  }

  async function uploadSelectedFile() {
    if (!uploadCandidateFile) {
      throw new Error('Select a file.')
    }

    if (!isPublicSelectionValid) {
      throw new Error('Select “Show in Looks” or “Show in Portfolio”.')
    }

    const kind = isEligibleForLooks ? 'LOOKS_PUBLIC' : 'PORTFOLIO_PUBLIC'

    const res = await fetch('/api/pro/uploads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind,
        contentType: uploadCandidateFile.type || 'application/octet-stream',
        size: uploadCandidateFile.size,
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
      throw new Error('Upload init failed (missing bucket/path/token).')
    }

    const { error: uploadError } = await supabaseBrowser.storage
      .from(init.bucket)
      .uploadToSignedUrl(init.path, init.token, uploadCandidateFile, {
        contentType: uploadCandidateFile.type || undefined,
        upsert: false,
      })

    if (uploadError) {
      throw new Error(uploadError.message || 'Upload failed.')
    }

    return {
      storageBucket: init.bucket,
      storagePath: init.path,
      publicUrl: init.publicUrl,
    }
  }

  async function submit() {
    if (!canSubmit) {
      setError(primaryBlockingReason ?? 'Fix the form before posting.')
      return
    }

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
    } catch (nextError: unknown) {
      setError(
        nextError instanceof Error ? nextError.message : 'Failed to create post.',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
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
                void handleFileChange(e.target.files?.[0] || null)
              }}
              className="block w-full text-[13px] text-textPrimary"
            />

            <div className="text-[11px] text-textSecondary">
              Images are optimized automatically before upload. You can also crop
              them to fit the Looks UI.
            </div>

            {file && mediaType === MediaType.IMAGE ? (
              <div className="grid gap-2 rounded-xl border border-white/10 bg-bgPrimary p-3">
                {uploadPreviewUrl ? (
                  <div className="overflow-hidden rounded-card border border-white/10 bg-black">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={uploadPreviewUrl}
                      alt="Selected upload preview"
                      className="block max-h-[280px] w-full object-contain"
                    />
                  </div>
                ) : null}

                <div className="text-[12px] font-semibold text-textSecondary">
                  {imageStatusCopy ?? 'Select an image to continue.'}
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setImageEditorOpen(true)}
                    disabled={!file || imagePreparing}
                    className="rounded-full border border-white/10 bg-bgSecondary px-3 py-2 text-[12px] font-black text-textPrimary hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Crop / adjust image
                  </button>
                </div>
              </div>
            ) : null}

            {file && fileError ? (
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
              onChange={(e) => {
                setCaption(e.target.value)
                setError(null)
              }}
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
                setError(null)
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
                onChange={(e) => {
                  setIsEligibleForLooks(e.target.checked)
                  setError(null)
                }}
                className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
              />
              Show in Looks
            </label>

            <label className="flex items-center gap-2 text-[12px] font-black text-textPrimary">
              <input
                type="checkbox"
                checked={isFeaturedInPortfolio}
                onChange={(e) => {
                  setIsFeaturedInPortfolio(e.target.checked)
                  setError(null)
                }}
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

            {servicesLoading ? (
              <div className="text-[12px] text-textSecondary">
                Loading services…
              </div>
            ) : services.length === 0 ? (
              <div className="text-[12px] text-toneDanger">
                {servicesLoadError ?? 'No services found. Add services first.'}
              </div>
            ) : (
              <>
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

                <div className="text-[11px] text-textSecondary">
                  {serviceIds.length === 0
                    ? 'No services selected yet.'
                    : `${serviceIds.length} service${serviceIds.length === 1 ? '' : 's'} selected.`}
                </div>
              </>
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
                  onChange={(e) => {
                    setPrimaryServiceId(
                      e.target.value ? e.target.value : null,
                    )
                    setError(null)
                  }}
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
                    Choose one primary service for Looks when multiple services
                    are selected.
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
                      setError(null)
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
                    onChange={(e) => {
                      setPriceStartingAt(normalizeMoneyInput(e.target.value))
                      setError(null)
                    }}
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

          {showBlockingBox && blockingReasons.length > 0 ? (
            <div className="rounded-xl border border-toneDanger/40 bg-toneDanger/10 px-3 py-3 text-[12px] text-toneDanger">
              <div className="font-black">Before you can post:</div>
              <ul className="mt-2 list-disc pl-5">
                {blockingReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {error ? (
            <div className="text-[12px] text-toneDanger">{error}</div>
          ) : null}

          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            aria-disabled={!canSubmit}
            className={[
              'rounded-card border px-4 py-3 text-[13px] font-black transition',
              canSubmit
                ? 'border-accentPrimary/60 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover'
                : 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70',
            ].join(' ')}
          >
            {saving
              ? 'Posting…'
              : canSubmit
                ? 'Post'
                : 'Fix required items to post'}
          </button>
        </div>
      </div>

      <ImageEditModal
        open={imageEditorOpen}
        file={file && mediaType === MediaType.IMAGE ? file : null}
        onClose={() => setImageEditorOpen(false)}
        onApply={(result) => {
          setProcessedImage(result)
          setError(null)
        }}
      />
    </>
  )
}
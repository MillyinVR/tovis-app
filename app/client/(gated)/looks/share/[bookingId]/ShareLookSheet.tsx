'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import ToggleSwitch from '@/app/_components/ToggleSwitch'
import RemoteImage from '@/app/_components/media/RemoteImage'
import { cn } from '@/lib/utils'
import { isRecord } from '@/lib/guards'
import { compressImageForUpload } from '@/lib/media/processImageForUpload'
import { uploadWithProgress } from '@/lib/media/uploadWithProgress'
import type { ShareLookPageData, ShareLookPrefillPhoto } from './_data/loadShareLookPage'
import { shareLookCopy as copy } from './shareLookCopy'

type PhotoSource = { reuseMediaAssetId: string } | { uploadSessionId: string }

type SlotState = {
  source: PhotoSource | null
  previewUrl: string | null
  status: 'idle' | 'uploading' | 'error'
  error: string | null
}

function initialSlot(prefill: ShareLookPrefillPhoto | null): SlotState {
  if (!prefill) return { source: null, previewUrl: null, status: 'idle', error: null }
  return {
    source: { reuseMediaAssetId: prefill.reuseMediaAssetId },
    previewUrl: prefill.previewUrl,
    status: 'idle',
    error: null,
  }
}

type SignedUploadInit = {
  bucket: string
  path: string
  token: string
  uploadSessionId: string | null
}

function parseInit(data: unknown): SignedUploadInit | null {
  if (!isRecord(data)) return null
  const d = data
  const bucket = typeof d.bucket === 'string' ? d.bucket : ''
  const path = typeof d.path === 'string' ? d.path : ''
  const token = typeof d.token === 'string' ? d.token : ''
  if (!bucket || !path || !token) return null
  return {
    bucket,
    path,
    token,
    uploadSessionId: typeof d.uploadSessionId === 'string' ? d.uploadSessionId : null,
  }
}

export default function ShareLookSheet({ data }: { data: ShareLookPageData }) {
  const router = useRouter()

  const [before, setBefore] = useState<SlotState>(() => initialSlot(data.prefill.before))
  const [after, setAfter] = useState<SlotState>(() => initialSlot(data.prefill.after))
  const [name, setName] = useState(data.suggestedName)
  const [caption, setCaption] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const busy = submitting || before.status === 'uploading' || after.status === 'uploading'

  async function uploadPhoto(
    file: File,
    phase: 'BEFORE' | 'AFTER',
    setSlot: (next: SlotState) => void,
  ): Promise<void> {
    setSlot({ source: null, previewUrl: URL.createObjectURL(file), status: 'uploading', error: null })

    try {
      const uploadFile = await compressImageForUpload(file)

      const res = await fetch('/api/client/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'LOOK_PUBLIC',
          contentType: uploadFile.type,
          size: uploadFile.size,
          phase,
          bookingId: data.bookingId,
        }),
      })

      const init = parseInit(await res.json().catch(() => null))
      if (!res.ok || !init || !init.uploadSessionId) {
        throw new Error('Upload init failed.')
      }

      const { error } = await uploadWithProgress({
        bucket: init.bucket,
        path: init.path,
        token: init.token,
        file: uploadFile,
        contentType: uploadFile.type || 'application/octet-stream',
        onProgress: () => {},
        signal: new AbortController().signal,
      })

      if (error) throw new Error(error)

      setSlot({
        source: { uploadSessionId: init.uploadSessionId },
        previewUrl: URL.createObjectURL(uploadFile),
        status: 'idle',
        error: null,
      })
    } catch {
      setSlot({ source: null, previewUrl: null, status: 'error', error: copy.errorGeneric })
    }
  }

  function onPick(
    phase: 'BEFORE' | 'AFTER',
    setSlot: (next: SlotState) => void,
  ) {
    return (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file) void uploadPhoto(file, phase, setSlot)
    }
  }

  async function onSubmit() {
    setFormError(null)

    if (!after.source) {
      setFormError(copy.errorMissingAfter)
      return
    }
    if (!name.trim()) {
      setFormError(copy.errorMissingName)
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(
        `/api/client/bookings/${encodeURIComponent(data.bookingId)}/share-look`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'idempotency-key': crypto.randomUUID(),
          },
          body: JSON.stringify({
            name: name.trim(),
            caption: caption.trim() || null,
            isPublic,
            after: after.source,
            before: before.source ?? undefined,
          }),
        },
      )

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null
        throw new Error(body?.message || copy.errorGeneric)
      }

      router.push('/client/me')
      router.refresh()
    } catch (error) {
      setFormError(error instanceof Error ? error.message : copy.errorGeneric)
      setSubmitting(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-[470px] px-5 pb-28 pt-6 text-textPrimary">
      <header className="mb-5">
        <h1 className="font-display text-[22px] font-semibold italic leading-none">
          {copy.title}
        </h1>
        <div className="mt-2 text-[11px] font-bold uppercase tracking-[0.12em] text-textSecondary">
          {copy.subtitlePrefix} · {data.visitDateLabel} · {data.professionalName}
        </div>
      </header>

      {/* before / after */}
      <div className="mb-5 grid grid-cols-2 gap-2">
        <PhotoSlot
          label={copy.beforeLabel}
          slot={before}
          optional
          onPick={onPick('BEFORE', setBefore)}
          onClear={() => setBefore({ source: null, previewUrl: null, status: 'idle', error: null })}
        />
        <PhotoSlot
          label={copy.afterLabel}
          slot={after}
          onPick={onPick('AFTER', setAfter)}
          onClear={() => setAfter({ source: null, previewUrl: null, status: 'idle', error: null })}
        />
      </div>

      {/* name */}
      <FieldLabel>{copy.nameLabel}</FieldLabel>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder={copy.namePlaceholder}
        maxLength={80}
        className="mb-4 w-full rounded-[13px] border border-textPrimary/20 bg-bgSecondary px-4 py-3 text-[15px] font-semibold text-textPrimary outline-none focus:border-accentPrimary"
      />

      {/* caption */}
      <FieldLabel>{copy.captionLabel}</FieldLabel>
      <textarea
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder={copy.captionPlaceholder}
        maxLength={300}
        rows={3}
        className="mb-4 w-full resize-none rounded-[13px] border border-textPrimary/10 bg-bgSecondary px-4 py-3 text-[13.5px] text-textPrimary outline-none focus:border-accentPrimary"
      />

      {/* tagged pro */}
      <FieldLabel>{copy.taggedProLabel}</FieldLabel>
      <div className="mb-5 flex items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-full border border-textPrimary/10 bg-bgSecondary py-1.5 pl-1.5 pr-3">
          <ProChipAvatar
            name={data.professionalName}
            avatarUrl={data.professionalAvatarUrl}
          />
          <span className="text-[12.5px] font-semibold text-textPrimary">
            {data.professionalName}
          </span>
        </span>
      </div>

      {/* visibility */}
      <div className="flex items-center justify-between gap-3 border-t border-textPrimary/10 py-4">
        <div className="min-w-0">
          <div className="text-[14px] font-semibold text-textPrimary">
            {copy.visibilityTitle}
          </div>
          <div className="mt-0.5 text-[12px] text-textSecondary">
            {copy.visibilityHelp}
          </div>
        </div>
        <ToggleSwitch
          checked={isPublic}
          onChange={setIsPublic}
          label={copy.visibilityTitle}
          size="lg"
        />
      </div>

      {formError ? (
        <div className="mt-4 rounded-[13px] border border-toneDanger/30 bg-toneDanger/10 px-4 py-3 text-[13px] text-toneDanger">
          {formError}
        </div>
      ) : null}

      {/* CTAs */}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setIsPublic(true)
          void onSubmit()
        }}
        className="mt-5 flex h-[50px] w-full items-center justify-center rounded-[15px] bg-accentPrimary text-[15px] font-bold text-bgPrimary transition hover:opacity-90 disabled:opacity-60"
      >
        {submitting ? copy.uploading : copy.shareCta}
      </button>
      <div className="mt-3 text-center">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setIsPublic(false)
            void onSubmit()
          }}
          className="text-[13px] font-semibold text-textSecondary transition hover:text-textPrimary disabled:opacity-60"
        >
          {copy.privateCta}
        </button>
      </div>
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-textSecondary">
      {children}
    </div>
  )
}

function PhotoSlot(props: {
  label: string
  slot: SlotState
  optional?: boolean
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void
  onClear: () => void
}) {
  const { label, slot, optional, onPick, onClear } = props
  const hasPhoto = Boolean(slot.previewUrl)

  return (
    <div className="relative aspect-[1/1.15] overflow-hidden rounded-[16px] border border-textPrimary/10 bg-bgSecondary">
      {slot.previewUrl ? (
        <RemoteImage
          src={slot.previewUrl ?? ''}
          alt={label}
          className="h-full w-full object-cover"
          loading="lazy"
          intrinsic
        />
      ) : (
        <div className="grid h-full place-items-center px-3 text-center">
          <div className="text-[12px] text-textSecondary">
            {optional ? `${label} (optional)` : label}
          </div>
        </div>
      )}

      <span className="pointer-events-none absolute bottom-2 left-2 rounded-md bg-bgPrimary/70 px-2 py-1 text-[9px] font-bold uppercase tracking-[0.1em] text-textPrimary">
        {label}
      </span>

      <label
        className={cn(
          'absolute right-2 top-2 grid h-8 cursor-pointer place-items-center rounded-lg bg-bgPrimary/70 px-2 text-[11px] font-bold text-textPrimary',
          slot.status === 'uploading' && 'pointer-events-none opacity-70',
        )}
      >
        {slot.status === 'uploading'
          ? '…'
          : hasPhoto
            ? 'Replace'
            : 'Add'}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onPick}
        />
      </label>

      {hasPhoto && optional && slot.status !== 'uploading' ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={`Remove ${label} photo`}
          className="tap-target-keep absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-bgPrimary/70 text-textPrimary"
        >
          ✕
        </button>
      ) : null}

      {slot.status === 'error' ? (
        <div className="absolute inset-x-2 bottom-9 rounded-md bg-toneDanger/80 px-2 py-1 text-[10px] text-bgPrimary">
          {slot.error}
        </div>
      ) : null}
    </div>
  )
}

function ProChipAvatar(props: { name: string; avatarUrl: string | null }) {
  if (props.avatarUrl) {
    return (
      <span className="block h-5 w-5 overflow-hidden rounded-full bg-bgPrimary">
        <RemoteImage
          src={props.avatarUrl ?? ''}
          alt={props.name}
          className="h-full w-full object-cover"
          loading="lazy"
          width={20}
          height={20}
        />
      </span>
    )
  }
  return (
    <span
      className="grid h-5 w-5 place-items-center rounded-full bg-accentPrimary/20 text-[10px] font-black text-accentPrimary"
      aria-hidden="true"
    >
      {props.name.trim().slice(0, 1).toUpperCase() || 'P'}
    </span>
  )
}

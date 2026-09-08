'use client'

import Image from 'next/image'
import { useState } from 'react'
import { isRecord } from '@/lib/guards'
import type { ConsultLookBriefPhotosDTO } from '@/lib/dto/consult'

function parsePhotos(raw: unknown): ConsultLookBriefPhotosDTO {
  const validUrl = (value: unknown): value is string => typeof value === 'string' && /^https?:\/\//.test(value)
  if (!isRecord(raw) || !Array.isArray(raw.captures) || raw.captures.length > 16 ||
    (raw.inspirationUrl !== null && !validUrl(raw.inspirationUrl)) ||
    typeof raw.expiresInSeconds !== 'number' || raw.expiresInSeconds <= 0) throw new Error('Could not read consultation photos.')
  const captures = raw.captures.map(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.label !== 'string' || !validUrl(item.url)) throw new Error('Could not read consultation photos.')
    return { id: item.id, label: item.label, url: item.url }
  })
  return { captures, inspirationUrl: raw.inspirationUrl, expiresInSeconds: raw.expiresInSeconds }
}

export default function ConsultLookBriefPhotos({ consultId }: { consultId: string }) {
  const [photos, setPhotos] = useState<ConsultLookBriefPhotosDTO | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function load() {
    setBusy(true); setError(null)
    try {
      const response = await fetch(`/api/v1/pro/consults/${encodeURIComponent(consultId)}/look-plan/photos`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Photos are unavailable. They may have expired or been removed.')
      setPhotos(parsePhotos(await response.json()))
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Could not load photos.') }
    finally { setBusy(false) }
  }
  const images = photos ? [
    ...(photos.inspirationUrl ? [{ id: 'inspiration', label: 'Inspiration look', url: photos.inspirationUrl }] : []),
    ...photos.captures,
  ] : []
  return <section className="grid gap-3" aria-label="Consultation photos">
    <button type="button" onClick={() => void load()} disabled={busy}
      className="justify-self-start rounded-full border border-surfaceGlass/20 px-4 py-2 text-sm font-semibold text-textPrimary">
      {busy ? 'Loading photos…' : photos ? 'Refresh photos' : 'View inspiration and starting-point photos'}
    </button>
    {error && <p role="alert" className="text-sm text-textSecondary">{error}</p>}
    {photos && !images.length && <p className="text-sm text-textSecondary">No retained photos are available for this consultation.</p>}
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {images.map(photo => <figure key={photo.id}>
        <a href={photo.url} target="_blank" rel="noreferrer" aria-label={`Open ${photo.label}`}>
          <Image src={photo.url} alt={photo.label} width={480} height={640} unoptimized
            className="aspect-[3/4] w-full rounded-xl bg-bgPrimary object-contain"
            onError={() => setError('A photo link expired. Refresh photos to view it again.')} />
        </a>
        <figcaption className="mt-1 text-xs text-textSecondary">{photo.label}</figcaption>
      </figure>)}
    </div>
  </section>
}

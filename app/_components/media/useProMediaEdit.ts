// app/_components/media/useProMediaEdit.ts
'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { isRecord } from '@/lib/guards'
import { safeJson } from '@/lib/http'
import { pickString } from '@/lib/pick'

/**
 * The asset-editing half of a pro's media controls — caption, service tags and
 * the before/after pairing — as one hook, so the two surfaces that offer them
 * (`OwnerMediaMenu` on `/media/[id]` and the library's manage sheet) share the
 * state machine and the write instead of keeping two copies of it.
 *
 * 🔴 Visibility is deliberately NOT here. The library's whole thesis is that
 * publishing is ONE act with its destinations written down before it lands, so
 * the two independent Looks/portfolio toggles belong to the caller that still
 * wants them (`OwnerMediaMenu`), passed through `save({ extra })`. A sheet that
 * only edits an asset sends neither flag, and the PATCH route leaves both — and
 * now the caption too — untouched when they are absent.
 */

export const PRO_MEDIA_CAPTION_MAX = 300

export type ProMediaEditInitial = {
  caption: string | null
  serviceIds: string[]
  /** The currently-paired "before" asset, or null when unpaired. */
  beforeAssetId: string | null
}

export type ProMediaBeforeOption = {
  id: string
  thumbUrl: string
  phase: string
}

export type ProMediaServiceOption = {
  id: string
  name: string
}

type JsonObject = Record<string, unknown>

export async function safeJsonObject(res: Response): Promise<JsonObject> {
  const data = await safeJson(res)
  return isRecord(data) ? data : {}
}

export function pickErrorMessage(data: JsonObject, fallback: string): string {
  const e = data.error
  if (typeof e === 'string' && e.trim()) return e.trim()

  const m = data.message
  if (typeof m === 'string' && m.trim()) return m.trim()

  return fallback
}

export function uniqueStrings(input: string[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const v of input) {
    const s = (v || '').trim()
    if (!s) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

export type ProMediaEdit = {
  caption: string
  setCaption: (value: string) => void

  selectedServiceIds: string[]
  toggleService: (id: string) => void
  removeService: (id: string) => void
  serviceQuery: string
  setServiceQuery: (value: string) => void
  filteredServices: ProMediaServiceOption[]
  serviceNameById: Map<string, string>
  /** The PATCH refuses a save with no tags, so the form blocks it first. */
  hasService: boolean

  beforeAssetId: string | null
  chooseBefore: (id: string | null) => void
  beforeOptions: ProMediaBeforeOption[]
  beforeOptionsLoaded: boolean

  isVideo: boolean
  saving: boolean
  error: string | null
  setError: (value: string | null) => void
  /** True when a save would be accepted: not busy, and at least one tag. */
  canSave: boolean

  /**
   * PATCHes the asset. `extra` is merged into the body for callers that also
   * own visibility. Resolves true on success; on failure it sets `error` and
   * resolves false, so the caller can keep the editor open.
   */
  save: (extra?: JsonObject) => Promise<boolean>
  /** DELETEs the asset. The caller owns the confirmation prompt. */
  remove: () => Promise<boolean>
}

export function useProMediaEdit(args: {
  mediaId: string
  initial: ProMediaEditInitial
  serviceOptions: ProMediaServiceOption[]
  isVideo?: boolean
  /**
   * Whether the editor is on screen. The before/after candidates are fetched
   * lazily the first time it is, so a grid of tiles doesn't fire one request
   * per tile just by rendering.
   */
  active: boolean
}): ProMediaEdit {
  const { mediaId, initial, serviceOptions, active } = args
  const isVideo = Boolean(args.isVideo)

  const [caption, setCaption] = useState(initial.caption ?? '')
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(
    uniqueStrings(initial.serviceIds ?? []),
  )
  const [serviceQuery, setServiceQuery] = useState('')

  // `beforeAssetId` is only sent once the pro actually touches the picker, so an
  // ordinary caption save never clobbers the server's default-on auto-pairing.
  const [beforeAssetId, setBeforeAssetId] = useState<string | null>(
    initial.beforeAssetId ?? null,
  )
  const [pairingTouched, setPairingTouched] = useState(false)
  const [beforeOptions, setBeforeOptions] = useState<ProMediaBeforeOption[]>([])
  const [beforeOptionsLoaded, setBeforeOptionsLoaded] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!active || isVideo || beforeOptionsLoaded) return
    let cancelled = false

    void (async () => {
      try {
        const res = await fetch(
          `/api/v1/pro/media/${encodeURIComponent(mediaId)}/before-options`,
          { cache: 'no-store' },
        )
        const data = await safeJsonObject(res)
        if (cancelled) return
        const raw = Array.isArray(data.options) ? data.options : []
        const clean: ProMediaBeforeOption[] = raw
          .filter(isRecord)
          .map((o) => ({
            id: pickString(o.id) ?? '',
            thumbUrl: pickString(o.thumbUrl) ?? '',
            phase: pickString(o.phase) ?? '',
          }))
          .filter((o) => o.id && o.thumbUrl)
        setBeforeOptions(clean)
        setBeforeOptionsLoaded(true)
      } catch {
        if (!cancelled) setBeforeOptionsLoaded(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [active, isVideo, beforeOptionsLoaded, mediaId])

  const filteredServices = useMemo(() => {
    const q = serviceQuery.trim().toLowerCase()
    if (!q) return serviceOptions
    return serviceOptions.filter((s) => s.name.toLowerCase().includes(q))
  }, [serviceOptions, serviceQuery])

  const serviceNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of serviceOptions) map.set(s.id, s.name)
    return map
  }, [serviceOptions])

  const toggleService = useCallback((id: string) => {
    setSelectedServiceIds((prev) =>
      uniqueStrings(
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
      ),
    )
    setError(null)
  }, [])

  const removeService = useCallback((id: string) => {
    setSelectedServiceIds((prev) => prev.filter((x) => x !== id))
    setError(null)
  }, [])

  const chooseBefore = useCallback((id: string | null) => {
    setBeforeAssetId(id)
    setPairingTouched(true)
    setError(null)
  }, [])

  const hasService = selectedServiceIds.length > 0
  const canSave = !saving && hasService

  const save = useCallback(
    async (extra?: JsonObject): Promise<boolean> => {
      if (saving) return false
      setError(null)

      if (selectedServiceIds.length === 0) {
        setError('Attach at least 1 service before saving.')
        return false
      }

      setSaving(true)
      try {
        const res = await fetch(
          `/api/v1/pro/media/${encodeURIComponent(mediaId)}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              caption: caption.trim().slice(0, PRO_MEDIA_CAPTION_MAX) || null,
              serviceIds: selectedServiceIds,
              ...(pairingTouched ? { beforeAssetId } : {}),
              ...(extra ?? {}),
            }),
          },
        )
        const data = await safeJsonObject(res)
        if (!res.ok) {
          throw new Error(
            pickErrorMessage(data, `Request failed (${res.status})`),
          )
        }
        return true
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to save.')
        return false
      } finally {
        setSaving(false)
      }
    },
    [saving, selectedServiceIds, mediaId, caption, pairingTouched, beforeAssetId],
  )

  const remove = useCallback(async (): Promise<boolean> => {
    if (saving) return false
    setError(null)
    setSaving(true)

    try {
      const res = await fetch(
        `/api/v1/pro/media/${encodeURIComponent(mediaId)}`,
        { method: 'DELETE' },
      )
      const data = await safeJsonObject(res)
      if (!res.ok) {
        throw new Error(pickErrorMessage(data, `Request failed (${res.status})`))
      }
      return true
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete.')
      return false
    } finally {
      setSaving(false)
    }
  }, [saving, mediaId])

  return {
    caption,
    setCaption,
    selectedServiceIds,
    toggleService,
    removeService,
    serviceQuery,
    setServiceQuery,
    filteredServices,
    serviceNameById,
    hasService,
    beforeAssetId,
    chooseBefore,
    beforeOptions,
    beforeOptionsLoaded,
    isVideo,
    saving,
    error,
    setError,
    canSave,
    save,
    remove,
  }
}

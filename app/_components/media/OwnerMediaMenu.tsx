// app/_components/media/OwnerMediaMenu.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UI_SIZES } from '@/app/(main)/ui/layoutConstants'
import { zClass } from '@/lib/zIndex'
import { MediaVisibility } from '@prisma/client'
import { cn } from '@/lib/utils'
import { safeJson } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { pickString } from '@/lib/pick'
import RemoteImage from '@/app/_components/media/RemoteImage'

type Visibility = MediaVisibility
type ServiceOption = { id: string; name: string }
type BeforeOption = { id: string; thumbUrl: string; phase: string }

type Props = {
  mediaId: string
  initial: {
    caption: string | null
    visibility: Visibility
    isEligibleForLooks: boolean
    isFeaturedInPortfolio: boolean
    serviceIds: string[]
    /** Currently-paired "before" asset id (drives the comparison slider), or null. */
    beforeAssetId: string | null
  }
  serviceOptions: ServiceOption[]
  /** Videos can't be a before/after "after" — hides the pairing picker. */
  isVideo?: boolean
  /**
   * §18d — whether this media is the pro's current creator-page cover banner.
   * Drives the "Set as cover" ↔ "Remove cover" menu action. Covers are images
   * only, so the action is hidden for videos.
   */
  isCover?: boolean
}

type JsonObject = Record<string, unknown>

const CAPTION_MAX = 300

async function safeJsonObject(res: Response): Promise<JsonObject> {
  const data = await safeJson(res)
  return isRecord(data) ? data : {}
}

function pickErrorMessage(data: JsonObject, fallback: string) {
  const e = data.error
  if (typeof e === 'string' && e.trim()) return e.trim()

  const m = data.message
  if (typeof m === 'string' && m.trim()) return m.trim()

  return fallback
}

function uniqueStrings(input: string[]) {
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

/**
 * ✅ Single source of truth:
 * visibility is derived from the two public surfaces.
 */
function visibilityFromFlags(flags: { isEligibleForLooks: boolean; isFeaturedInPortfolio: boolean }): Visibility {
  return flags.isEligibleForLooks || flags.isFeaturedInPortfolio ? MediaVisibility.PUBLIC : MediaVisibility.PRO_CLIENT
}

export default function OwnerMediaMenu({ mediaId, initial, serviceOptions, isVideo = false, isCover = false }: Props) {
  const router = useRouter()

  const [openMenu, setOpenMenu] = useState(false)
  const [openEdit, setOpenEdit] = useState(false)

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // §18d — creator-page cover banner. Optimistic so the menu label flips instantly.
  const [cover, setCover] = useState(Boolean(isCover))

  // Edit state
  const [caption, setCaption] = useState(initial.caption ?? '')
  const [isEligibleForLooks, setIsEligibleForLooks] = useState(Boolean(initial.isEligibleForLooks))
  const [isFeaturedInPortfolio, setIsFeaturedInPortfolio] = useState(Boolean(initial.isFeaturedInPortfolio))
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(uniqueStrings(initial.serviceIds ?? []))
  const [serviceQuery, setServiceQuery] = useState('')

  // Before/after pairing state. `beforeAssetId` is the chosen "before" (null =
  // unpaired). Only sent to the server when the pro actually touches the picker,
  // so an unrelated save doesn't clobber the default-on auto-pairing.
  const [beforeAssetId, setBeforeAssetId] = useState<string | null>(initial.beforeAssetId ?? null)
  const [pairingTouched, setPairingTouched] = useState(false)
  const [beforeOptions, setBeforeOptions] = useState<BeforeOption[]>([])
  const [beforeOptionsLoaded, setBeforeOptionsLoaded] = useState(false)

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const busy = saving

  const isPublicSurfaceOn = isEligibleForLooks || isFeaturedInPortfolio
  const computedVisibility = visibilityFromFlags({ isEligibleForLooks, isFeaturedInPortfolio })
  const mustHaveService = selectedServiceIds.length > 0

  // Close the 3-dot menu when clicking outside
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const el = wrapRef.current
      if (!el) return
      if (el.contains(e.target as Node)) return
      setOpenMenu(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Lazy-load the booking's candidate "before" photos the first time the edit
  // modal opens for an image (videos can't have a before/after pairing).
  useEffect(() => {
    if (!openEdit || isVideo || beforeOptionsLoaded) return
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
        const clean: BeforeOption[] = raw
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
  }, [openEdit, isVideo, beforeOptionsLoaded, mediaId])

  // Footer + safe-area math so the modal never hides behind bottom nav
  const footerPx = UI_SIZES.footerHeight ?? 0
  const modalMaxHeight = `calc(100dvh - ${footerPx}px - 18px)`
  const actionSafePaddingBottom = `calc(${footerPx}px + env(safe-area-inset-bottom, 0px) + 14px)`

  const filteredServices = useMemo(() => {
    const q = serviceQuery.trim().toLowerCase()
    if (!q) return serviceOptions
    return serviceOptions.filter((s) => s.name.toLowerCase().includes(q))
  }, [serviceOptions, serviceQuery])

  const selectedServiceMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const s of serviceOptions) map.set(s.id, s.name)
    return map
  }, [serviceOptions])

  function toggleService(id: string) {
    setSelectedServiceIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      return uniqueStrings(next)
    })
    setError(null)
  }

  function removeService(id: string) {
    setSelectedServiceIds((prev) => prev.filter((x) => x !== id))
    setError(null)
  }

  function closeEdit() {
    if (busy) return
    setOpenEdit(false)
    setError(null)
  }

  /**
   * ✅ Segmented control behavior while keeping a single source of truth:
   * - Selecting PUBLIC ensures at least one public surface is enabled.
   * - Selecting PRO_CLIENT turns both public surfaces off.
   */
  function onChangeVisibility(next: Visibility) {
    setError(null)

    if (next === MediaVisibility.PUBLIC) {
      // If user wants "public" and neither surface is on, turn on portfolio by default.
      if (!isPublicSurfaceOn) setIsFeaturedInPortfolio(true)
      return
    }

    if (next === MediaVisibility.PRO_CLIENT) {
      // Private means no public surfaces.
      if (isEligibleForLooks) setIsEligibleForLooks(false)
      if (isFeaturedInPortfolio) setIsFeaturedInPortfolio(false)
    }
  }

  async function saveEdits() {
    if (saving) return
    setError(null)

    // Hard rule: media must always have >= 1 service tag
    if (!mustHaveService) {
      setError('Attach at least 1 service before saving.')
      return
    }

    setSaving(true)

    try {
      const res = await fetch(`/api/v1/pro/media/${encodeURIComponent(mediaId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption: caption.trim().slice(0, CAPTION_MAX) || null,

          // ✅ single truth = flags
          isEligibleForLooks,
          isFeaturedInPortfolio,
          serviceIds: selectedServiceIds,

          // Only send the pairing when the pro actually changed it, so a normal
          // save doesn't override the server's default-on auto-pairing.
          ...(pairingTouched ? { beforeAssetId } : {}),

          // optional compatibility: send computed visibility (server should still normalize)
          visibility: computedVisibility,
        }),
      })

      const data = await safeJsonObject(res)
      if (!res.ok) {
        throw new Error(pickErrorMessage(data, `Request failed (${res.status})`))
      }

      setOpenEdit(false)
      setOpenMenu(false)
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteMedia() {
    if (saving) return
    setError(null)

    if (typeof window === 'undefined') return
    const ok = window.confirm('Delete this media? This cannot be undone.')
    if (!ok) return

    setSaving(true)
    try {
      const res = await fetch(`/api/v1/pro/media/${encodeURIComponent(mediaId)}`, { method: 'DELETE' })
      const data = await safeJsonObject(res)
      if (!res.ok) {
        throw new Error(pickErrorMessage(data, `Request failed (${res.status})`))
      }

      setOpenMenu(false)
      setOpenEdit(false)
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete.')
    } finally {
      setSaving(false)
    }
  }

  async function toggleCover() {
    if (saving) return
    setError(null)
    setSaving(true)

    const nextCover = !cover
    try {
      const res = await fetch(
        `/api/v1/pro/media/${encodeURIComponent(mediaId)}/cover`,
        { method: nextCover ? 'POST' : 'DELETE' },
      )
      const data = await safeJsonObject(res)
      if (!res.ok) {
        throw new Error(pickErrorMessage(data, `Request failed (${res.status})`))
      }

      setCover(nextCover)
      setOpenMenu(false)
      router.refresh()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update cover.')
    } finally {
      setSaving(false)
    }
  }

  const canSave = !busy && mustHaveService

  return (
    <div ref={wrapRef} className="relative">
      {/* ⋯ button */}
      <button
        type="button"
        onClick={() => setOpenMenu((v) => !v)}
        className={cn(
          'tap-target',
          'inline-flex h-10 w-10 items-center justify-center rounded-full',
          'border border-white/12 bg-bgPrimary/20 backdrop-blur-xl',
          'text-white/90 shadow-[0_10px_30px_rgba(0,0,0,0.35)]',
          'hover:bg-white/10 active:scale-[0.99] transition',
        )}
        aria-label="Media options"
        title="Options"
      >
        <span className="text-[20px] leading-none">⋯</span>
      </button>

      {/* Menu */}
      {openMenu ? (
        <div
          className={cn(
            'absolute right-0 mt-2 w-44 overflow-hidden rounded-[16px]',
            'border border-white/12 bg-bgPrimary/70 backdrop-blur-xl',
            'shadow-[0_18px_60px_rgba(0,0,0,0.55)]',
          )}
        >
          <button
            type="button"
            onClick={() => {
              setOpenMenu(false)
              setOpenEdit(true)
              setError(null)
            }}
            className="block w-full px-4 py-3 text-left text-[13px] font-black text-textPrimary hover:bg-white/10"
          >
            Edit
          </button>

          {/* §18d — cover banner (images only). */}
          {!isVideo ? (
            <button
              type="button"
              onClick={toggleCover}
              disabled={saving}
              className={cn(
                'block w-full px-4 py-3 text-left text-[13px] font-black text-textPrimary hover:bg-white/10',
                saving ? 'cursor-not-allowed opacity-70' : '',
              )}
            >
              {cover ? 'Remove cover photo' : 'Set as cover photo'}
            </button>
          ) : null}

          <button
            type="button"
            onClick={deleteMedia}
            className="block w-full px-4 py-3 text-left text-[13px] font-black text-toneDanger hover:bg-white/10"
          >
            Delete
          </button>
        </div>
      ) : null}

      {/* Edit modal */}
      {openEdit ? (
        <div className={`fixed inset-0 ${zClass.modal} bg-black/60`} onClick={closeEdit}>
          <div
            className={cn(
              'mx-auto mt-4 w-full max-w-[560px] overflow-hidden rounded-[18px]',
              'border border-white/12 bg-bgPrimary/70 backdrop-blur-2xl',
              'shadow-[0_22px_90px_rgba(0,0,0,0.70)]',
              'grid grid-rows-[auto_1fr_auto]',
            )}
            style={{ maxHeight: modalMaxHeight }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Edit media"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="grid">
                <div className="text-[13px] font-black text-textPrimary">Edit media</div>
                <div className="text-[11px] font-semibold text-textSecondary">Luxury controls. Zero confusion.</div>
              </div>

              <button
                type="button"
                onClick={closeEdit}
                className={cn(
                  'tap-target',
                  'grid h-9 w-9 place-items-center rounded-full border text-[14px] font-black',
                  busy
                    ? 'cursor-not-allowed border-white/10 text-white/50 opacity-70'
                    : 'border-white/12 bg-bgPrimary/30 text-white hover:bg-white/10',
                )}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="looksNoScrollbar overflow-y-auto p-4">
              <div className="grid gap-4">
                {/* Caption */}
                <Field
                  label="Caption"
                  right={
                    <span className="text-[11px] font-semibold text-textSecondary">
                      {caption.trim().length}/{CAPTION_MAX}
                    </span>
                  }
                >
                  <textarea
                    value={caption}
                    onChange={(e) => setCaption(e.target.value.slice(0, CAPTION_MAX))}
                    rows={3}
                    disabled={busy}
                    className={cn(
                      'w-full resize-y rounded-[16px] border border-white/10 bg-bgPrimary/35',
                      'px-3 py-3 text-[13px] text-textPrimary outline-none',
                      'focus:ring-2 focus:ring-accentPrimary/35',
                    )}
                    placeholder="Write a caption…"
                  />
                </Field>

                {/* Visibility (derived) */}
                <Field label="Who can view" hint="Public requires Looks or Portfolio enabled. Private means neither is enabled.">
                  <Segmented<Visibility>
                    value={computedVisibility}
                    disabled={busy}
                    onChange={(v) => onChangeVisibility(v)}
                    options={[
                      { value: MediaVisibility.PUBLIC, label: 'Public', sub: 'Visible to clients' },
                      { value: MediaVisibility.PRO_CLIENT, label: 'Client + you', sub: 'Private (not public)' },
                    ]}
                  />
                </Field>

                {/* Toggles */}
                <div className="rounded-[18px] border border-white/12 bg-bgPrimary/25 p-3">
                  <HermesToggleRow
                    label="Show in Looks feed"
                    hint="Discovery feed + more exposure."
                    value={isEligibleForLooks}
                    setValue={(v) => {
                      setIsEligibleForLooks(v)
                      setError(null)
                    }}
                    disabled={busy}
                  />
                  <div className="my-2 h-px bg-white/8" />
                  <HermesToggleRow
                    label="Feature in public portfolio"
                    hint="Appears on your profile grid."
                    value={isFeaturedInPortfolio}
                    setValue={(v) => {
                      setIsFeaturedInPortfolio(v)
                      setError(null)
                    }}
                    disabled={busy}
                  />
                </div>

                {/* Before / after pairing (images only) */}
                {!isVideo ? (
                  <Field
                    label="Before / after"
                    hint="Pair a “before” photo to show a comparison slider on your public portfolio."
                  >
                    <div className="flex flex-wrap gap-2 rounded-[18px] border border-white/10 bg-bgPrimary/25 p-3">
                      {!beforeOptionsLoaded ? (
                        <div className="grid h-16 place-items-center px-2 text-[11px] font-semibold text-textSecondary">
                          Loading…
                        </div>
                      ) : beforeOptions.length === 0 && beforeAssetId === null ? (
                        <div className="grid h-16 place-items-center px-2 text-[11px] font-semibold text-textSecondary">
                          No before photos from this booking to pair.
                        </div>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              setBeforeAssetId(null)
                              setPairingTouched(true)
                              setError(null)
                            }}
                            className={cn(
                              'grid h-16 w-16 place-items-center rounded-xl border text-[11px] font-black transition',
                              beforeAssetId === null
                                ? 'border-accentPrimary/40 bg-accentPrimary/15 text-accentPrimary'
                                : 'border-white/12 bg-bgPrimary/30 text-textSecondary hover:bg-white/5',
                              busy ? 'cursor-not-allowed opacity-70' : '',
                            )}
                            title="No before/after pairing"
                          >
                            None
                          </button>

                          {beforeOptions.map((opt) => {
                            const on = beforeAssetId === opt.id
                            return (
                              <button
                                key={opt.id}
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  setBeforeAssetId(opt.id)
                                  setPairingTouched(true)
                                  setError(null)
                                }}
                                className={cn(
                                  'relative h-16 w-16 overflow-hidden rounded-xl border transition',
                                  on
                                    ? 'border-accentPrimary shadow-[0_0_0_2px_rgb(var(--accent-primary)/0.45)]'
                                    : 'border-white/12 hover:border-white/30',
                                  busy ? 'cursor-not-allowed opacity-70' : '',
                                )}
                                title={
                                  opt.phase === 'BEFORE'
                                    ? 'Before photo'
                                    : 'Photo from this booking'
                                }
                              >
                                <RemoteImage
                                  src={opt.thumbUrl}
                                  alt="Before candidate"
                                  width={128}
                                  height={128}
                                  className="h-full w-full object-cover"
                                />
                                {on ? (
                                  <span className="absolute bottom-1 right-1 grid h-4 w-4 place-items-center rounded-full bg-accentPrimary text-[10px] font-black text-bgPrimary">
                                    ✓
                                  </span>
                                ) : null}
                              </button>
                            )
                          })}
                        </>
                      )}
                    </div>
                  </Field>
                ) : null}

                {/* Services */}
                <Field
                  label="Services attached"
                  hint="At least 1 service is required."
                  right={<span className="text-[11px] font-semibold text-textSecondary">{selectedServiceIds.length} selected</span>}
                >
                  {selectedServiceIds.length ? (
                    <div className="flex flex-wrap gap-2 rounded-[18px] border border-white/10 bg-bgPrimary/25 p-3">
                      {selectedServiceIds.slice(0, 10).map((id) => {
                        const name = selectedServiceMap.get(id) || 'Service'
                        return (
                          <button
                            key={id}
                            type="button"
                            disabled={busy}
                            onClick={() => removeService(id)}
                            className={cn(
                              'inline-flex items-center gap-2 rounded-full px-3 py-1',
                              'border border-white/12 bg-bgPrimary/30 backdrop-blur-xl',
                              'text-[12px] font-extrabold text-textPrimary',
                              busy ? 'opacity-70' : 'hover:bg-white/10',
                            )}
                            title="Remove"
                          >
                            <span className="max-w-[220px] truncate">{name}</span>
                            <span className="text-white/70" aria-hidden="true">
                              ✕
                            </span>
                          </button>
                        )
                      })}
                      {selectedServiceIds.length > 10 ? (
                        <div className="rounded-full border border-white/10 bg-bgPrimary/25 px-3 py-1 text-[12px] font-extrabold text-textSecondary">
                          +{selectedServiceIds.length - 10} more
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-[18px] border border-toneDanger/30 bg-toneDanger/10 p-3 text-[12px] font-semibold text-toneDanger">
                      Attach at least 1 service to save.
                    </div>
                  )}

                  <div className="mt-3">
                    <input
                      value={serviceQuery}
                      onChange={(e) => setServiceQuery(e.target.value)}
                      placeholder="Search services…"
                      disabled={busy}
                      className={cn(
                        'w-full rounded-[16px] border border-white/10 bg-bgPrimary/35',
                        'px-3 py-2 text-[13px] text-textPrimary outline-none',
                        'focus:ring-2 focus:ring-accentPrimary/35',
                      )}
                    />
                  </div>

                  <div className="mt-2 max-h-[260px] overflow-auto rounded-[18px] border border-white/10 bg-bgPrimary/20">
                    {filteredServices.map((s) => {
                      const on = selectedServiceIds.includes(s.id)
                      return (
                        <button
                          key={s.id}
                          type="button"
                          disabled={busy}
                          onClick={() => toggleService(s.id)}
                          className={cn(
                            'flex w-full items-center justify-between gap-3 px-4 py-3 text-left',
                            'border-b border-white/5 last:border-b-0',
                            busy ? 'opacity-70' : 'hover:bg-white/5',
                          )}
                        >
                          <span className="text-[13px] font-black text-textPrimary">{s.name}</span>

                          <span
                            className={cn(
                              'inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black',
                              on
                                ? 'border border-accentPrimary/30 bg-accentPrimary/20 text-accentPrimary'
                                : 'border border-white/10 bg-bgPrimary/25 text-textSecondary',
                            )}
                          >
                            <span className={cn('h-1.5 w-1.5 rounded-full', on ? 'bg-accentPrimary' : 'bg-white/35')} />
                            {on ? 'Selected' : 'Add'}
                          </span>
                        </button>
                      )
                    })}

                    {filteredServices.length === 0 ? (
                      <div className="px-4 py-4 text-[12px] font-semibold text-textSecondary">No services found.</div>
                    ) : null}
                  </div>
                </Field>

                {error ? (
                  <div className="rounded-[14px] border border-white/10 bg-black/20 p-3 text-[12px] font-semibold text-toneDanger">
                    {error}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Actions */}
            <div
              className="border-t border-white/10 bg-bgPrimary/85 px-4 py-3 backdrop-blur-2xl"
              style={{ paddingBottom: actionSafePaddingBottom }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold text-white/55">
                  {computedVisibility === MediaVisibility.PRO_CLIENT ? 'Private to client + you.' : 'Public visibility enabled.'}
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeEdit}
                    disabled={busy}
                    className={cn(
                      'rounded-[16px] border px-4 py-3 text-[13px] font-black transition',
                      busy
                        ? 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70'
                        : 'border-white/12 bg-bgPrimary/35 text-textPrimary hover:bg-white/5',
                    )}
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={saveEdits}
                    disabled={!canSave}
                    className={cn(
                      'rounded-[16px] border px-4 py-3 text-[13px] font-black transition',
                      !canSave
                        ? 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70'
                        : 'border-accentPrimary/40 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
                    )}
                    title={!mustHaveService ? 'Attach at least 1 service' : undefined}
                  >
                    {busy ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function Field({
  label,
  hint,
  right,
  children,
}: {
  label: string
  hint?: string
  right?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-end justify-between gap-2">
        <div className="grid">
          <div className="text-[12px] font-black text-textSecondary">{label}</div>
          {hint ? <div className="mt-0.5 text-[11px] font-semibold text-white/55">{hint}</div> : null}
        </div>
        {right ? <div>{right}</div> : null}
      </div>
      {children}
    </div>
  )
}

function Segmented<T extends string>({
  value,
  disabled,
  onChange,
  options,
}: {
  value: T
  disabled?: boolean
  onChange: (v: T) => void
  options: Array<{ value: T; label: string; sub?: string }>
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-2 rounded-[18px] border border-white/12 bg-bgPrimary/25 p-2',
        disabled ? 'opacity-70' : '',
      )}
      role="radiogroup"
      aria-disabled={disabled ? 'true' : 'false'}
    >
      {options.map((opt) => {
        const active = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-[16px] border px-3 py-3 text-left transition',
              'backdrop-blur-xl',
              active
                ? 'border-accentPrimary/35 bg-accentPrimary/15 shadow-[0_10px_30px_rgba(0,0,0,0.25)]'
                : 'border-white/10 bg-bgPrimary/25 hover:bg-white/5',
              disabled ? 'cursor-not-allowed' : 'active:scale-[0.99]',
            )}
            role="radio"
            aria-checked={active ? 'true' : 'false'}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-[13px] font-black text-textPrimary">{opt.label}</div>
              <div className={cn('h-2 w-2 rounded-full', active ? 'bg-accentPrimary' : 'bg-white/35')} />
            </div>
            {opt.sub ? <div className="mt-0.5 text-[11px] font-semibold text-textSecondary">{opt.sub}</div> : null}
          </button>
        )
      })}
    </div>
  )
}

function HermesToggleRow({
  label,
  hint,
  value,
  setValue,
  disabled,
}: {
  label: string
  hint?: string
  value: boolean
  setValue: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && setValue(!value)}
      disabled={disabled}
      className={cn(
        'flex w-full items-center justify-between gap-3 rounded-[16px] px-3 py-3 text-left transition',
        disabled ? 'cursor-not-allowed opacity-70' : 'hover:bg-white/5 active:scale-[0.995]',
      )}
    >
      <div className="min-w-0">
        <div className="text-[13px] font-black text-textPrimary">{label}</div>
        {hint ? <div className="mt-0.5 text-[11px] font-semibold text-textSecondary">{hint}</div> : null}
      </div>

      <div className="flex items-center gap-2">
        <span
          className={cn(
            'hidden sm:inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black',
            value
              ? 'border border-accentPrimary/25 bg-accentPrimary/15 text-accentPrimary'
              : 'border border-white/10 bg-bgPrimary/25 text-textSecondary',
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', value ? 'bg-accentPrimary' : 'bg-white/35')} />
          {value ? 'Enabled' : 'Disabled'}
        </span>

        <div
          className={cn(
            'relative h-7 w-14 rounded-full border p-1 transition',
            value ? 'border-accentPrimary/35 bg-accentPrimary/80' : 'border-white/12 bg-bgPrimary/50',
          )}
          aria-hidden="true"
        >
          <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/10 to-transparent" />

          <div
            className={cn(
              'relative h-5 w-5 rounded-full bg-white transition',
              'shadow-[0_10px_25px_rgba(0,0,0,0.35)]',
              value ? 'translate-x-7' : 'translate-x-0',
            )}
          >
            <div
              className={cn(
                'absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full',
                value ? 'bg-accentPrimary' : 'bg-black/25',
              )}
            />
          </div>
        </div>
      </div>
    </button>
  )
}
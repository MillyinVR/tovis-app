// app/_components/media/OwnerMediaMenu.tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UI_SIZES } from '@/app/(main)/ui/layoutConstants'
import { zClass } from '@/lib/zIndex'
import { MediaVisibility } from '@/lib/prismaEnums'
import { cn } from '@/lib/utils'

import ProMediaEditFields, { Field } from './ProMediaEditFields'
import {
  pickErrorMessage,
  safeJsonObject,
  useProMediaEdit,
} from './useProMediaEdit'

type Visibility = MediaVisibility
type ServiceOption = { id: string; name: string }

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
  /**
   * Whether this media is the pro's current SIGNATURE post — their own chosen
   * highlight, promoted above the public profile's grid. Drives the
   * "Set as Signature" ↔ "Remove Signature" action.
   *
   * 🔴 Never label it "Featured" or "Spotlight": `isFeaturedInPortfolio` and
   * `LookPost.featuredAt` already own those words, and the second of them means
   * an ADMIN picked you. Signature is the pro's own claim about their own work.
   * Photos only, like the cover.
   */
  isSignature?: boolean
}

/**
 * ✅ Single source of truth:
 * visibility is derived from the two public surfaces.
 */
function visibilityFromFlags(flags: {
  isEligibleForLooks: boolean
  isFeaturedInPortfolio: boolean
}): Visibility {
  return flags.isEligibleForLooks || flags.isFeaturedInPortfolio
    ? MediaVisibility.PUBLIC
    : MediaVisibility.PRO_CLIENT
}

/**
 * The owner's controls on `/media/[id]`.
 *
 * The caption / pairing / service-tag fields and the PATCH+DELETE writes live in
 * `useProMediaEdit` + `ProMediaEditFields`, shared with the pro library's manage
 * sheet. What stays here is what only this surface has: the ⋯ menu, the cover
 * and Signature actions, and the two visibility flags — which the library
 * deliberately does not offer, because there publishing is one act rather than
 * two toggles the pro has to reason about.
 */
export default function OwnerMediaMenu({
  mediaId,
  initial,
  serviceOptions,
  isVideo = false,
  isCover = false,
  isSignature = false,
}: Props) {
  const router = useRouter()

  const [openMenu, setOpenMenu] = useState(false)
  const [openEdit, setOpenEdit] = useState(false)

  // Actions that live outside the shared editor keep their own busy flag.
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  // §18d — creator-page cover banner. Optimistic so the menu label flips instantly.
  const [cover, setCover] = useState(Boolean(isCover))

  // The pro's own Signature post. Same optimistic treatment as the cover.
  const [signature, setSignature] = useState(Boolean(isSignature))

  const [isEligibleForLooks, setIsEligibleForLooks] = useState(
    Boolean(initial.isEligibleForLooks),
  )
  const [isFeaturedInPortfolio, setIsFeaturedInPortfolio] = useState(
    Boolean(initial.isFeaturedInPortfolio),
  )

  const edit = useProMediaEdit({
    mediaId,
    initial: {
      caption: initial.caption ?? null,
      serviceIds: initial.serviceIds ?? [],
      beforeAssetId: initial.beforeAssetId ?? null,
    },
    serviceOptions,
    isVideo,
    active: openEdit,
  })

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const busy = edit.saving || actionBusy

  const isPublicSurfaceOn = isEligibleForLooks || isFeaturedInPortfolio
  const computedVisibility = visibilityFromFlags({
    isEligibleForLooks,
    isFeaturedInPortfolio,
  })

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

  // Footer + safe-area math so the modal never hides behind bottom nav
  const footerPx = UI_SIZES.footerHeight ?? 0
  const modalMaxHeight = `calc(100dvh - ${footerPx}px - 18px)`
  const actionSafePaddingBottom = `calc(${footerPx}px + env(safe-area-inset-bottom, 0px) + 14px)`

  function closeEdit() {
    if (busy) return
    setOpenEdit(false)
    edit.setError(null)
    setActionError(null)
  }

  /**
   * ✅ Segmented control behavior while keeping a single source of truth:
   * - Selecting PUBLIC ensures at least one public surface is enabled.
   * - Selecting PRO_CLIENT turns both public surfaces off.
   */
  function onChangeVisibility(next: Visibility) {
    edit.setError(null)

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
    if (busy) return

    // The flags ride along because this surface still owns them; the shared
    // editor sends only caption / tags / pairing.
    const ok = await edit.save({
      isEligibleForLooks,
      isFeaturedInPortfolio,
      // optional compatibility: send computed visibility (server should still normalize)
      visibility: computedVisibility,
    })
    if (!ok) return

    setOpenEdit(false)
    setOpenMenu(false)
    router.refresh()
  }

  async function deleteMedia() {
    if (busy) return
    setActionError(null)

    if (typeof window === 'undefined') return
    const ok = window.confirm('Delete this media? This cannot be undone.')
    if (!ok) return

    const removed = await edit.remove()
    if (!removed) return

    setOpenMenu(false)
    setOpenEdit(false)
    router.refresh()
  }

  async function toggleCover() {
    if (busy) return
    setActionError(null)
    setActionBusy(true)

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
      setActionError(
        e instanceof Error ? e.message : 'Failed to update cover.',
      )
    } finally {
      setActionBusy(false)
    }
  }

  async function toggleSignature() {
    if (busy) return
    setActionError(null)
    setActionBusy(true)

    const nextSignature = !signature
    try {
      const res = await fetch(
        `/api/v1/pro/media/${encodeURIComponent(mediaId)}/signature`,
        { method: nextSignature ? 'POST' : 'DELETE' },
      )
      const data = await safeJsonObject(res)
      if (!res.ok) {
        // The route refuses a photo that isn't a published, approved look — the
        // message says which, rather than the control claiming success and the
        // profile quietly showing nothing.
        throw new Error(pickErrorMessage(data, `Request failed (${res.status})`))
      }

      setSignature(nextSignature)
      setOpenMenu(false)
      router.refresh()
    } catch (e: unknown) {
      setActionError(
        e instanceof Error ? e.message : 'Failed to update Signature.',
      )
    } finally {
      setActionBusy(false)
    }
  }

  const canSave = edit.canSave && !actionBusy

  return (
    <div ref={wrapRef} className="relative">
      {/* ⋯ button */}
      <button
        type="button"
        onClick={() => setOpenMenu((v) => !v)}
        className={cn(
          'tap-target',
          'inline-flex h-10 w-10 items-center justify-center rounded-full',
          'border border-surfaceGlass/12 bg-bgPrimary/20 backdrop-blur-xl',
          'text-white/90 shadow-[0_10px_30px_rgb(var(--shadow-color)/0.35)]',
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
            'border border-surfaceGlass/12 bg-bgPrimary/70 backdrop-blur-xl',
            'shadow-[0_18px_60px_rgb(var(--shadow-color)/0.55)]',
          )}
        >
          <button
            type="button"
            onClick={() => {
              setOpenMenu(false)
              setOpenEdit(true)
              edit.setError(null)
              setActionError(null)
            }}
            className="block w-full px-4 py-3 text-left text-[13px] font-black text-textPrimary hover:bg-surfaceGlass/10"
          >
            Edit
          </button>

          {/* §18d — cover banner (images only). */}
          {!isVideo ? (
            <button
              type="button"
              onClick={toggleCover}
              disabled={busy}
              className={cn(
                'block w-full px-4 py-3 text-left text-[13px] font-black text-textPrimary hover:bg-surfaceGlass/10',
                busy ? 'cursor-not-allowed opacity-70' : '',
              )}
            >
              {cover ? 'Remove cover photo' : 'Set as cover photo'}
            </button>
          ) : null}

          {/* The pro's own Signature post (photos only, like the cover). */}
          {!isVideo ? (
            <button
              type="button"
              onClick={toggleSignature}
              disabled={busy}
              className={cn(
                'block w-full px-4 py-3 text-left text-[13px] font-black text-textPrimary hover:bg-surfaceGlass/10',
                busy ? 'cursor-not-allowed opacity-70' : '',
              )}
            >
              {signature ? 'Remove Signature' : 'Set as Signature'}
            </button>
          ) : null}

          <button
            type="button"
            onClick={deleteMedia}
            className="block w-full px-4 py-3 text-left text-[13px] font-black text-toneDanger hover:bg-surfaceGlass/10"
          >
            Delete
          </button>

          {actionError ? (
            <div className="border-t border-surfaceGlass/10 px-4 py-3 text-[11px] font-semibold text-toneDanger">
              {actionError}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Edit modal */}
      {openEdit ? (
        <div className={`fixed inset-0 ${zClass.modal} bg-scrim/60`} onClick={closeEdit}>
          <div
            className={cn(
              'mx-auto mt-4 w-full max-w-[560px] overflow-hidden rounded-[18px]',
              'border border-surfaceGlass/12 bg-bgPrimary/70 backdrop-blur-2xl',
              'shadow-[0_22px_90px_rgb(var(--shadow-color)/0.70)]',
              'grid grid-rows-[auto_1fr_auto]',
            )}
            style={{ maxHeight: modalMaxHeight }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Edit media"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-surfaceGlass/10 px-4 py-3">
              <div className="grid">
                <div className="text-[13px] font-black text-textPrimary">Edit media</div>
                <div className="text-[11px] font-semibold text-textSecondary">
                  Caption, tags and where it appears.
                </div>
              </div>

              <button
                type="button"
                onClick={closeEdit}
                className={cn(
                  'tap-target',
                  'grid h-9 w-9 place-items-center rounded-full border text-[14px] font-black',
                  busy
                    ? 'cursor-not-allowed border-surfaceGlass/10 text-textSecondary opacity-70'
                    : 'border-surfaceGlass/12 bg-bgPrimary/30 text-textPrimary hover:bg-surfaceGlass/10',
                )}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="looksNoScrollbar overflow-y-auto p-4">
              <div className="grid gap-4">
                {/* Visibility (derived) — this surface's own, not the shared editor's. */}
                <Field
                  label="Who can view"
                  hint="Public requires Looks or Portfolio enabled. Private means neither is enabled."
                >
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
                <div className="rounded-[18px] border border-surfaceGlass/12 bg-bgPrimary/25 p-3">
                  <HermesToggleRow
                    label="Show in Looks feed"
                    hint="Discovery feed + more exposure."
                    value={isEligibleForLooks}
                    setValue={(v) => {
                      setIsEligibleForLooks(v)
                      edit.setError(null)
                    }}
                    disabled={busy}
                  />
                  <div className="my-2 h-px bg-surfaceGlass/8" />
                  <HermesToggleRow
                    label="Feature in public portfolio"
                    hint="Appears on your profile grid."
                    value={isFeaturedInPortfolio}
                    setValue={(v) => {
                      setIsFeaturedInPortfolio(v)
                      edit.setError(null)
                    }}
                    disabled={busy}
                  />
                </div>

                <ProMediaEditFields edit={edit} />

                {actionError ? (
                  <div className="rounded-[14px] border border-toneDanger/30 bg-toneDanger/10 p-3 text-[12px] font-semibold text-toneDanger">
                    {actionError}
                  </div>
                ) : null}
              </div>
            </div>

            {/* Actions */}
            <div
              className="border-t border-surfaceGlass/10 bg-bgPrimary/85 px-4 py-3 backdrop-blur-2xl"
              style={{ paddingBottom: actionSafePaddingBottom }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold text-textPrimary/55">
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
                        ? 'cursor-not-allowed border-surfaceGlass/10 bg-bgPrimary text-textSecondary opacity-70'
                        : 'border-surfaceGlass/12 bg-bgPrimary/35 text-textPrimary hover:bg-surfaceGlass/5',
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
                        ? 'cursor-not-allowed border-surfaceGlass/10 bg-bgPrimary text-textSecondary opacity-70'
                        : 'border-accentPrimary/40 bg-accentPrimary text-onAccent hover:bg-accentPrimaryHover',
                    )}
                    title={!edit.hasService ? 'Attach at least 1 service' : undefined}
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
        'grid grid-cols-2 gap-2 rounded-[18px] border border-surfaceGlass/12 bg-bgPrimary/25 p-2',
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
                ? 'border-accentPrimary/35 bg-accentPrimary/15 shadow-[0_10px_30px_rgb(var(--shadow-color)/0.25)]'
                : 'border-surfaceGlass/10 bg-bgPrimary/25 hover:bg-surfaceGlass/5',
              disabled ? 'cursor-not-allowed' : 'active:scale-[0.99]',
            )}
            role="radio"
            aria-checked={active ? 'true' : 'false'}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="text-[13px] font-black text-textPrimary">{opt.label}</div>
              <div className={cn('h-2 w-2 rounded-full', active ? 'bg-accentPrimary' : 'bg-surfaceGlass/35')} />
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
        disabled ? 'cursor-not-allowed opacity-70' : 'hover:bg-surfaceGlass/5 active:scale-[0.995]',
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
              : 'border border-surfaceGlass/10 bg-bgPrimary/25 text-textSecondary',
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full', value ? 'bg-accentPrimary' : 'bg-surfaceGlass/35')} />
          {value ? 'Enabled' : 'Disabled'}
        </span>

        <div
          className={cn(
            'relative h-7 w-14 rounded-full border p-1 transition',
            value ? 'border-accentPrimary/35 bg-accentPrimary/80' : 'border-surfaceGlass/12 bg-bgPrimary/50',
          )}
          aria-hidden="true"
        >
          <div className="absolute inset-0 rounded-full bg-gradient-to-b from-surfaceGlass/10 to-transparent" />

          <div
            className={cn(
              'relative h-5 w-5 rounded-full bg-textPrimary transition',
              'shadow-[0_10px_25px_rgb(var(--shadow-color)/0.35)]',
              value ? 'translate-x-7' : 'translate-x-0',
            )}
          >
            <div
              className={cn(
                'absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full',
                value ? 'bg-accentPrimary' : 'bg-bgPrimary/25',
              )}
            />
          </div>
        </div>
      </div>
    </button>
  )
}

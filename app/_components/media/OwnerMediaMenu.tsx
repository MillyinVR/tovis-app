// app/_components/media/OwnerMediaMenu.tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { UI_SIZES } from '@/app/(main)/ui/layoutConstants'

type Visibility = 'PUBLIC' | 'PRIVATE'
type ServiceOption = { id: string; name: string }

type Props = {
  mediaId: string
  initial: {
    caption: string | null
    visibility: Visibility
    isEligibleForLooks: boolean
    isFeaturedInPortfolio: boolean
    serviceIds: string[]
  }
  serviceOptions: ServiceOption[]
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
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

export default function OwnerMediaMenu({ mediaId, initial, serviceOptions }: Props) {
  const router = useRouter()

  const [openMenu, setOpenMenu] = useState(false)
  const [openEdit, setOpenEdit] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Edit state
  const [caption, setCaption] = useState(initial.caption ?? '')
  const [visibility, setVisibility] = useState<Visibility>(initial.visibility)
  const [isEligibleForLooks, setIsEligibleForLooks] = useState(Boolean(initial.isEligibleForLooks))
  const [isFeaturedInPortfolio, setIsFeaturedInPortfolio] = useState(Boolean(initial.isFeaturedInPortfolio))
  const [selectedServiceIds, setSelectedServiceIds] = useState<string[]>(uniqueStrings(initial.serviceIds ?? []))
  const [serviceQuery, setServiceQuery] = useState('')

  const wrapRef = useRef<HTMLDivElement | null>(null)

  // Close the 3-dot menu when clicking outside
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current) return
      if (wrapRef.current.contains(e.target as Node)) return
      setOpenMenu(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Footer + safe-area math so the modal never hides behind bottom nav
  const footerPx = UI_SIZES.footerHeight ?? 0
  const modalSafePaddingBottom = `calc(${footerPx}px + env(safe-area-inset-bottom, 0px) + 18px)`
  const modalMaxHeight = `calc(100dvh - ${footerPx}px - 18px)`

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

  const selectedServiceNames = useMemo(() => {
    return selectedServiceIds
      .map((id) => selectedServiceMap.get(id) || '')
      .filter(Boolean)
      .slice(0, 12)
  }, [selectedServiceIds, selectedServiceMap])

  function toggleService(id: string) {
    setSelectedServiceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function removeService(id: string) {
    setSelectedServiceIds((prev) => prev.filter((x) => x !== id))
  }

  async function saveEdits() {
    if (saving) return
    setSaving(true)
    setError(null)

    try {
      const res = await fetch(`/api/pro/media/${encodeURIComponent(mediaId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          caption: caption.trim() || null,
          visibility,
          isEligibleForLooks,
          isFeaturedInPortfolio,
          serviceIds: selectedServiceIds,
        }),
      })

      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)

      setOpenEdit(false)
      setOpenMenu(false)
      router.refresh()
    } catch (e: any) {
      setError(e?.message || 'Failed to save.')
    } finally {
      setSaving(false)
    }
  }

  async function deleteMedia() {
    if (saving) return
    setError(null)

    const ok = window.confirm('Delete this media? This cannot be undone.')
    if (!ok) return

    setSaving(true)
    try {
      const res = await fetch(`/api/pro/media/${encodeURIComponent(mediaId)}`, { method: 'DELETE' })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)

      setOpenMenu(false)
      setOpenEdit(false)
      router.refresh()
    } catch (e: any) {
      setError(e?.message || 'Failed to delete.')
    } finally {
      setSaving(false)
    }
  }

  const busy = saving

  return (
    <div ref={wrapRef} className="relative">
      {/* ⋯ button */}
      <button
        type="button"
        onClick={() => setOpenMenu((v) => !v)}
        className={cx(
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
          className={cx(
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
            }}
            className="block w-full px-4 py-3 text-left text-[13px] font-black text-textPrimary hover:bg-white/10"
          >
            Edit
          </button>

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
        <div className="fixed inset-0 z-[9999] bg-black/60" onClick={() => !busy && setOpenEdit(false)}>
          {/* Centered sheet */}
          <div
            className={cx(
              'mx-auto mt-4 w-full max-w-[560px] overflow-hidden rounded-[18px]',
              'border border-white/12 bg-bgPrimary/70 backdrop-blur-2xl',
              'shadow-[0_22px_90px_rgba(0,0,0,0.70)]',
            )}
            style={{
              maxHeight: modalMaxHeight,
              paddingBottom: modalSafePaddingBottom,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="grid">
                <div className="text-[13px] font-black text-textPrimary">Edit media</div>
                <div className="text-[11px] font-semibold text-textSecondary">Luxury controls. Zero confusion.</div>
              </div>

              <button
                type="button"
                onClick={() => !busy && setOpenEdit(false)}
                className={cx(
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

            {/* Scrollable body */}
            <div className="looksNoScrollbar max-h-[calc(100dvh-260px)] overflow-y-auto p-4">
              <div className="grid gap-4">
                {/* Caption */}
                <Field
                  label="Caption"
                  right={
                    <span className="text-[11px] font-semibold text-textSecondary">
                      {caption.trim().length}/300
                    </span>
                  }
                >
                  <textarea
                    value={caption}
                    onChange={(e) => setCaption(e.target.value.slice(0, 300))}
                    rows={3}
                    disabled={busy}
                    className={cx(
                      'w-full resize-y rounded-[16px] border border-white/10 bg-bgPrimary/35',
                      'px-3 py-3 text-[13px] text-textPrimary outline-none',
                      'focus:ring-2 focus:ring-accentPrimary/35',
                    )}
                    placeholder="Write a caption…"
                  />
                </Field>

                {/* Visibility (Hermès segmented) */}
                <Field label="Who can view" hint="Public shows everywhere you allow. Only you hides it completely.">
                  <Segmented
                    value={visibility}
                    disabled={busy}
                    onChange={setVisibility}
                    options={[
                      { value: 'PUBLIC', label: 'Public', sub: 'Visible to clients' },
                      { value: 'PRIVATE', label: 'Only you', sub: 'Hidden' },
                    ]}
                  />
                </Field>

                {/* Toggles (Hermès switch rows) */}
                <div className="rounded-[18px] border border-white/12 bg-bgPrimary/25 p-3">
                  <HermesToggleRow
                    label="Show in Looks feed"
                    hint="Discovery feed + more exposure."
                    value={isEligibleForLooks}
                    setValue={setIsEligibleForLooks}
                    disabled={busy}
                  />
                  <div className="my-2 h-px bg-white/8" />
                  <HermesToggleRow
                    label="Feature in public portfolio"
                    hint="Appears on your profile grid."
                    value={isFeaturedInPortfolio}
                    setValue={setIsFeaturedInPortfolio}
                    disabled={busy}
                  />
                </div>

                {/* Selected services tray */}
                <Field
                  label="Services attached"
                  right={
                    <span className="text-[11px] font-semibold text-textSecondary">
                      {selectedServiceIds.length} selected
                    </span>
                  }
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
                            className={cx(
                              'inline-flex items-center gap-2 rounded-full px-3 py-1',
                              'border border-white/12 bg-bgPrimary/30 backdrop-blur-xl',
                              'text-[12px] font-extrabold text-textPrimary',
                              busy ? 'opacity-70' : 'hover:bg-white/10',
                            )}
                            title="Remove"
                          >
                            <span className="max-w-[220px] truncate">{name}</span>
                            <span className="text-white/70">✕</span>
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
                    <div className="rounded-[18px] border border-white/10 bg-bgPrimary/25 p-3 text-[12px] font-semibold text-textSecondary">
                      No services attached yet.
                    </div>
                  )}

                  {/* Service search */}
                  <div className="mt-3">
                    <input
                      value={serviceQuery}
                      onChange={(e) => setServiceQuery(e.target.value)}
                      placeholder="Search services…"
                      disabled={busy}
                      className={cx(
                        'w-full rounded-[16px] border border-white/10 bg-bgPrimary/35',
                        'px-3 py-2 text-[13px] text-textPrimary outline-none',
                        'focus:ring-2 focus:ring-accentPrimary/35',
                      )}
                    />
                  </div>

                  {/* Service list */}
                  <div className="mt-2 max-h-[260px] overflow-auto rounded-[18px] border border-white/10 bg-bgPrimary/20">
                    {filteredServices.map((s) => {
                      const on = selectedServiceIds.includes(s.id)
                      return (
                        <button
                          key={s.id}
                          type="button"
                          disabled={busy}
                          onClick={() => toggleService(s.id)}
                          className={cx(
                            'flex w-full items-center justify-between gap-3 px-4 py-3 text-left',
                            'border-b border-white/5 last:border-b-0',
                            busy ? 'opacity-70' : 'hover:bg-white/5',
                          )}
                        >
                          <span className="text-[13px] font-black text-textPrimary">{s.name}</span>

                          <span
                            className={cx(
                              'inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black',
                              on
                                ? 'border border-accentPrimary/30 bg-accentPrimary/20 text-accentPrimary'
                                : 'border border-white/10 bg-bgPrimary/25 text-textSecondary',
                            )}
                          >
                            <span
                              className={cx(
                                'h-1.5 w-1.5 rounded-full',
                                on ? 'bg-accentPrimary' : 'bg-white/35',
                              )}
                            />
                            {on ? 'Selected' : 'Add'}
                          </span>
                        </button>
                      )
                    })}

                    {filteredServices.length === 0 ? (
                      <div className="px-4 py-4 text-[12px] font-semibold text-textSecondary">
                        No services found.
                      </div>
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

            {/* Sticky actions */}
            <div className="absolute inset-x-0 bottom-0 border-t border-white/10 bg-bgPrimary/85 px-4 py-3 backdrop-blur-2xl">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[11px] font-semibold text-white/55">
                  {visibility === 'PRIVATE' ? 'Hidden from public.' : 'Public visibility enabled.'}
                </div>

                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => !busy && setOpenEdit(false)}
                    disabled={busy}
                    className={cx(
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
                    disabled={busy}
                    className={cx(
                      'rounded-[16px] border px-4 py-3 text-[13px] font-black transition',
                      busy
                        ? 'cursor-not-allowed border-white/10 bg-bgPrimary text-textSecondary opacity-70'
                        : 'border-accentPrimary/40 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover',
                    )}
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
      className={cx(
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
            className={cx(
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
              <div
                className={cx(
                  'h-2 w-2 rounded-full',
                  active ? 'bg-accentPrimary' : 'bg-white/35',
                )}
              />
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
      className={cx(
        'flex w-full items-center justify-between gap-3 rounded-[16px] px-3 py-3 text-left transition',
        disabled ? 'cursor-not-allowed opacity-70' : 'hover:bg-white/5 active:scale-[0.995]',
      )}
    >
      <div className="min-w-0">
        <div className="text-[13px] font-black text-textPrimary">{label}</div>
        {hint ? <div className="mt-0.5 text-[11px] font-semibold text-textSecondary">{hint}</div> : null}
      </div>

      {/* Hermès-style: Status pill + switch with jewel dot */}
      <div className="flex items-center gap-2">
        <span
          className={cx(
            'hidden sm:inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black',
            value
              ? 'border border-accentPrimary/25 bg-accentPrimary/15 text-accentPrimary'
              : 'border border-white/10 bg-bgPrimary/25 text-textSecondary',
          )}
        >
          <span className={cx('h-1.5 w-1.5 rounded-full', value ? 'bg-accentPrimary' : 'bg-white/35')} />
          {value ? 'Enabled' : 'Disabled'}
        </span>

        <div
          className={cx(
            'relative h-7 w-14 rounded-full border p-1 transition',
            value ? 'border-accentPrimary/35 bg-accentPrimary/80' : 'border-white/12 bg-bgPrimary/50',
          )}
          aria-hidden="true"
        >
          {/* inner highlight */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-b from-white/10 to-transparent" />

          <div
            className={cx(
              'relative h-5 w-5 rounded-full bg-white transition',
              'shadow-[0_10px_25px_rgba(0,0,0,0.35)]',
              value ? 'translate-x-7' : 'translate-x-0',
            )}
          >
            {/* tiny “jewel” */}
            <div
              className={cx(
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

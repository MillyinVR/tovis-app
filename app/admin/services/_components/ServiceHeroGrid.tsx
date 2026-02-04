// app/admin/services/_components/ServiceHeroGrid.tsx
'use client'

import { useEffect, useMemo, useRef, useState, forwardRef, useImperativeHandle } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

type CategoryDTO = { id: string; name: string; parentId: string | null }

type ServiceDTO = {
  id: string
  name: string
  description: string | null
  defaultDurationMinutes: number | null
  minPrice: string | null
  defaultImageUrl: string | null
  allowMobile: boolean
  isActive: boolean
  isAddOnEligible: boolean
  addOnGroup: string | null
  categoryId: string | null
  categoryName: string | null
}

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

async function safeJson(res: Response) {
  return (await res.json().catch(() => ({}))) as any
}

function isAbsoluteHttpUrl(input: string) {
  try {
    const u = new URL(input)
    return u.protocol === 'https:' || u.protocol === 'http:'
  } catch {
    return false
  }
}

function fmtMinutes(v: number | null) {
  if (!v || !Number.isFinite(v) || v <= 0) return '—'
  if (v < 60) return `${v}m`
  const h = Math.floor(v / 60)
  const m = v % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function fmtMoney(v: string | null) {
  const s = (v ?? '').trim()
  if (!s) return '—'
  const n = Number(s)
  if (!Number.isFinite(n)) return `$${s}`
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' }).format(n)
}

function withCacheBuster(url: string, cb?: number | null) {
  const cacheBuster = typeof cb === 'number' ? cb : Date.now()
  try {
    const u = new URL(url)
    u.searchParams.set('v', String(cacheBuster))
    return u.toString()
  } catch {
    const joiner = url.includes('?') ? '&' : '?'
    return `${url}${joiner}v=${cacheBuster}`
  }
}

function haptic(ms = 8) {
  // Subtle “tap” feedback on supported devices (mobile mostly)
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(ms)
  } catch {
    // ignore
  }
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-surfaceGlass/12 bg-bgPrimary/25 px-2 py-0.5 text-[11px] font-extrabold text-textSecondary">
      {children}
    </span>
  )
}

function StatusPill(props: { dirty: boolean; saving: boolean }) {
  const { dirty, saving } = props
  const label = saving ? 'Saving…' : dirty ? 'Unsaved' : 'Saved'

  const tone = saving
    ? 'border-white/12 bg-bgPrimary/25 text-textSecondary'
    : dirty
      ? 'border-[rgb(var(--micro-accent))/0.35] bg-[rgb(var(--micro-accent))/0.12] text-textPrimary'
      : 'border-[rgb(var(--tone-success))/0.25] bg-[rgb(var(--tone-success))/0.10] text-textPrimary'

  return (
    <span className={cx('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-black', tone)}>
      {label}
    </span>
  )
}

/** Lock page scroll while modal is open */
function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    const prevOverflow = document.body.style.overflow
    const prevPaddingRight = document.body.style.paddingRight

    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`

    return () => {
      document.body.style.overflow = prevOverflow
      document.body.style.paddingRight = prevPaddingRight
    }
  }, [locked])
}

/** Focus trap + escape-to-close + focus restore */
function useModalA11y(args: { isOpen: boolean; panelRef: React.RefObject<HTMLElement | null>; onClose: () => void }) {
  const { isOpen, panelRef, onClose } = args
  const lastActiveRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isOpen) return
    lastActiveRef.current = document.activeElement as HTMLElement | null

    const panel = panelRef.current
    const focusable = getFocusable(panel)
    const first = focusable[0] ?? panel
    if (first && typeof (first as any).focus === 'function') {
      const t = window.setTimeout(() => (first as any).focus?.(), 0)
      return () => window.clearTimeout(t)
    }
  }, [isOpen, panelRef])

  useEffect(() => {
    if (!isOpen) return

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return

      const panel = panelRef.current
      const focusable = getFocusable(panel)
      if (!focusable.length) {
        e.preventDefault()
        panel?.focus?.()
        return
      }

      const active = document.activeElement as HTMLElement | null
      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (panel && active && !panel.contains(active)) {
        e.preventDefault()
        first.focus()
        return
      }

      if (e.shiftKey) {
        if (active === first) {
          e.preventDefault()
          last.focus()
        }
      } else {
        if (active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, panelRef, onClose])

  useEffect(() => {
    if (isOpen) return
    const el = lastActiveRef.current
    if (el && typeof el.focus === 'function') el.focus()
  }, [isOpen])
}

function getFocusable(root: HTMLElement | null) {
  if (!root) return []
  const selectors = [
    'a[href]',
    'button:not([disabled])',
    'textarea:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(selectors))
  return nodes.filter((n) => !n.hasAttribute('disabled') && n.tabIndex !== -1 && isVisible(n))
}

function isVisible(el: HTMLElement) {
  const rect = el.getBoundingClientRect()
  return Boolean(rect.width || rect.height)
}

/** Premium shimmer image */
function ImageWithShimmer(props: { src: string; alt?: string; className?: string }) {
  const { src, alt = '', className } = props
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setLoaded(false)
    setFailed(false)
  }, [src])

  return (
    <div className={cx('relative overflow-hidden', className)}>
      {!loaded && !failed ? (
        <div className="absolute inset-0">
          <div className="absolute inset-0 animate-pulse bg-bgPrimary/35" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120px_120px_at_20%_18%,rgb(255_255_255/0.10),transparent_60%)]" />
          <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.08),transparent)] translate-x-[-60%] animate-[shimmer_1.2s_infinite]" />
        </div>
      ) : null}

      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          className={cx('relative z-[1] h-full w-full object-cover transition-opacity', loaded ? 'opacity-100' : 'opacity-0')}
          onLoad={() => setLoaded(true)}
          onError={() => {
            setFailed(true)
            setLoaded(true)
          }}
        />
      ) : (
        <div className="relative z-[1] grid h-full w-full place-items-center text-xs font-extrabold text-textSecondary">
          Image failed to load
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 ring-1 ring-white/8" />

      <style jsx>{`
        @keyframes shimmer {
          0% {
            transform: translateX(-60%);
          }
          100% {
            transform: translateX(160%);
          }
        }
      `}</style>
    </div>
  )
}

type ToastState = { tone: 'success' | 'error'; title: string; body?: string | null }
function Toast(props: ToastState) {
  const toneClasses =
    props.tone === 'success'
      ? 'border-[rgb(var(--tone-success))/0.25] bg-[rgb(var(--tone-success))/0.10]'
      : 'border-[rgb(var(--tone-danger))/0.25] bg-[rgb(var(--tone-danger))/0.10]'

  return (
    <div
      className={cx(
        'rounded-2xl border px-4 py-3 shadow-[0_24px_90px_rgb(0_0_0/0.55)] backdrop-blur-xl',
        'tovis-glass-strong tovis-noise',
        toneClasses,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="text-sm font-black text-textPrimary">{props.title}</div>
      {props.body ? <div className="mt-0.5 text-xs text-textSecondary">{props.body}</div> : null}
    </div>
  )
}

export default function ServiceHeroGrid(props: { services: ServiceDTO[]; categories: CategoryDTO[] }) {
  const { services, categories } = props
  const router = useRouter()

  // Live state so hero cards update immediately when image uploads etc.
  const [liveServices, setLiveServices] = useState<ServiceDTO[]>(services)
  useEffect(() => setLiveServices(services), [services])

  const [openId, setOpenId] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Header UI state (fed by the form)
  const [dirty, setDirty] = useState(false)
  const [canSave, setCanSave] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)

  const [toast, setToast] = useState<ToastState | null>(null)
  const toastTimer = useRef<number | null>(null)

  const panelRef = useRef<HTMLDivElement | null>(null)
  const formRef = useRef<ServiceEditFormHandle | null>(null)

  const current = useMemo(() => liveServices.find((s) => s.id === openId) ?? null, [openId, liveServices])
  const isOpen = Boolean(current)

  useLockBodyScroll(isOpen)

  const close = () => {
    if (busy) return
    setOpenId(null)
    setError(null)
    setDirty(false)
    setCanSave(false)
    setUploadBusy(false)
  }

  useModalA11y({
    isOpen,
    panelRef: panelRef as any,
    onClose: close,
  })

  function showToast(next: ToastState, ms = 2400) {
    setToast(next)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), ms) as any
  }

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])

  function patchLiveService(id: string, patch: Partial<ServiceDTO>) {
    setLiveServices((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)))
  }

  async function save(id: string, payload: Record<string, any>) {
    setBusy(true)
    setError(null)

    try {
      const form = new FormData()
      form.set('_method', 'PATCH')
      Object.entries(payload).forEach(([k, v]) => {
        if (v === undefined) return
        form.set(k, String(v))
      })

      const res = await fetch(`/api/admin/services/${encodeURIComponent(id)}`, { method: 'POST', body: form })
      const data = await safeJson(res)

      if (!res.ok) {
        const msg = data?.error || `Save failed (${res.status}).`
        setError(msg)
        showToast({ tone: 'error', title: 'Save failed', body: msg })
        return
      }

      showToast({ tone: 'success', title: 'Saved', body: 'Service updated successfully.' }, 2000)
      setDirty(false)
      setCanSave(false)
      setOpenId(null)
      router.refresh()
    } catch {
      setError('Network error while saving.')
      showToast({ tone: 'error', title: 'Network error', body: 'Couldn’t reach the server.' })
    } finally {
      setBusy(false)
    }
  }

  const overlayFade = {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: 0.18, ease: 'easeOut' } },
    exit: { opacity: 0, transition: { duration: 0.14, ease: 'easeIn' } },
  } as const

  const panelSlide = {
    initial: { opacity: 0, y: 18, scale: 0.996 },
    animate: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 380, damping: 34, mass: 0.9 } },
    exit: { opacity: 0, y: 14, transition: { duration: 0.14, ease: 'easeIn' } },
  } as const

  const inputBase =
    'w-full rounded-xl border border-surfaceGlass/15 bg-bgPrimary/50 px-3 py-2 text-sm text-textPrimary placeholder:text-textSecondary/70 outline-none focus:border-surfaceGlass/30'

  const btnBase =
    'inline-flex items-center justify-center rounded-full px-3 py-2 text-xs font-extrabold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60'

  const btnSoft =
    'border border-surfaceGlass/15 bg-bgPrimary/35 text-textPrimary hover:border-surfaceGlass/25 hover:bg-bgPrimary/45'

  const btnAccent =
    'border border-accentPrimary/40 bg-accentPrimary/14 text-textPrimary hover:border-accentPrimary/60 hover:bg-accentPrimary/18'

  const btnPrimary =
    'border border-accentPrimary/55 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover shadow-[0_16px_40px_rgb(0_0_0/0.35)]'

  return (
    <>
      {/* Toast */}
      <AnimatePresence>
        {toast ? (
          <motion.div
            key="toast"
            className="fixed right-3 top-3 z-[9999] w-[min(380px,calc(100vw-24px))]"
            initial={{ opacity: 0, y: -10, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: { type: 'spring', stiffness: 420, damping: 34 } }}
            exit={{ opacity: 0, y: -10, transition: { duration: 0.16 } }}
          >
            <Toast tone={toast.tone} title={toast.title} body={toast.body ?? null} />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Hero cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {liveServices.map((s) => (
          <div
            key={s.id}
            className={cx(
              'relative overflow-hidden rounded-card border border-surfaceGlass/10 bg-bgSecondary',
              'shadow-[0_18px_50px_rgb(0_0_0/0.45)]',
            )}
          >
            <div
              className={cx(
                'pointer-events-none absolute inset-0',
                "before:absolute before:inset-0 before:content-['']",
                'before:bg-[radial-gradient(700px_260px_at_30%_0%,rgb(255_255_255/0.12),transparent_60%)]',
                "after:absolute after:inset-0 after:content-['']",
                'after:bg-[linear-gradient(135deg,rgb(var(--accent-primary)/0.16),transparent_38%,rgb(var(--micro-accent)/0.12))]',
                'after:opacity-70',
              )}
            />
            <div className="pointer-events-none absolute inset-0 ring-1 ring-white/8" />

            <div className="relative p-3">
              <div className="relative overflow-hidden rounded-2xl border border-surfaceGlass/12 bg-bgPrimary/25">
                <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(80px_80px_at_20%_18%,rgb(255_255_255/0.12),transparent_60%)]" />
                {s.defaultImageUrl ? (
                  <ImageWithShimmer src={s.defaultImageUrl} className="aspect-[16/10] w-full" />
                ) : (
                  <div className="grid aspect-[16/10] w-full place-items-center text-xs font-extrabold text-textSecondary">
                    No image
                  </div>
                )}
              </div>

              <div className="mt-3 grid gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-black text-textPrimary">{s.name}</div>
                    <div className="mt-0.5 text-[12px] font-extrabold text-textSecondary">{s.categoryName ?? '— Category'}</div>
                  </div>
                  <Chip>{s.isActive ? 'Active' : 'Disabled'}</Chip>
                </div>

                <div className="text-[12px] text-textSecondary">
                  {s.description?.trim() ? s.description : 'No description yet. Add one so this reads like a real catalog.'}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Chip>Min {fmtMoney(s.minPrice)}</Chip>
                  <Chip>Default {fmtMinutes(s.defaultDurationMinutes)}</Chip>
                  {s.allowMobile ? <Chip>Mobile</Chip> : <Chip>Salon-only</Chip>}
                  {s.isAddOnEligible ? <Chip>Add-on{s.addOnGroup ? ` • ${s.addOnGroup}` : ''}</Chip> : null}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <div className="text-[11px] text-textSecondary">
                  App image: <span className="font-extrabold">defaultImageUrl</span>
                </div>

                <button
                  type="button"
                  className={cx(btnBase, btnAccent)}
                  onClick={() => {
                    haptic(8)
                    setOpenId(s.id)
                  }}
                >
                  Edit
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      <AnimatePresence>
        {current ? (
          <motion.div key="svc-edit" className="fixed inset-0 z-[9000]" initial="initial" animate="animate" exit="exit">
            <motion.button type="button" aria-label="Close" onClick={close} className="absolute inset-0 bg-black/80 backdrop-blur-lg" variants={overlayFade} />

            <div className="absolute inset-0 z-[9001] flex items-end justify-center px-2 sm:items-start sm:px-3 sm:pt-10">
              <motion.div
                ref={panelRef}
                variants={panelSlide}
                role="dialog"
                aria-modal="true"
                aria-label={`Edit service: ${current.name}`}
                tabIndex={-1}
                className={cx(
                  'relative w-full max-w-3xl overflow-hidden outline-none',
                  'tovis-glass-strong tovis-noise',
                  'rounded-t-[26px] sm:rounded-[26px] border border-white/12',
                  'shadow-[0_50px_160px_rgb(0_0_0/0.78)]',
                  // key: panel is a column; body scrolls
                  'max-h-[calc(100vh-12px)] sm:max-h-[calc(100vh-80px)]',
                  'flex flex-col',
                )}
              >
                <div className="pointer-events-none absolute inset-0 tovis-overlay-scrim" />
                <div className="pointer-events-none absolute inset-0 ring-1 ring-white/10" />

                {/* Header (sticky inside panel) */}
                <div className="relative z-[2] flex items-start justify-between gap-3 border-b border-white/10 bg-bgSecondary/70 px-4 py-3 backdrop-blur-xl">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-[14px] font-black tracking-[0.04em] text-textPrimary">Edit service</div>
                      <StatusPill dirty={dirty} saving={busy} />
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-textSecondary">{current.name}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* ✅ Save moved to top-left of Close (in this right cluster it reads perfectly on mobile) */}
                    <button
                      type="button"
                      className={cx(btnBase, btnPrimary)}
                      disabled={!canSave || busy || uploadBusy}
                      onClick={() => {
                        haptic(10)
                        formRef.current?.submit()
                      }}
                    >
                      {busy ? 'Saving…' : 'Save'}
                    </button>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        haptic(6)
                        close()
                      }}
                      className={cx(btnBase, btnSoft)}
                    >
                      Close
                    </button>
                  </div>
                </div>

                {/* Scroll body */}
                <div className={cx('relative z-[1] flex-1 overflow-y-auto overscroll-contain', 'looksNoScrollbar')}>
                  <ServiceEditForm
                    ref={formRef}
                    service={current}
                    categories={categories}
                    inputBase={inputBase}
                    busy={busy}
                    error={error}
                    onClose={close}
                    onToast={showToast}
                    onOptimistic={(patch) => patchLiveService(current.id, patch)}
                    onMetaChange={(m) => {
                      setDirty(m.dirty)
                      setCanSave(m.canSave)
                      setUploadBusy(m.uploadBusy)
                    }}
                    onSave={(payload) => save(current.id, payload)}
                  />
                </div>
              </motion.div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  )
}

type ServiceEditMeta = { dirty: boolean; canSave: boolean; uploadBusy: boolean }

type ServiceEditFormHandle = {
  submit: () => void
}

const ServiceEditForm = forwardRef<
  ServiceEditFormHandle,
  {
    service: ServiceDTO
    categories: CategoryDTO[]
    inputBase: string
    busy: boolean
    error: string | null
    onClose: () => void
    onSave: (payload: Record<string, any>) => void
    onOptimistic: (patch: Partial<ServiceDTO>) => void
    onToast: (t: ToastState, ms?: number) => void
    onMetaChange: (m: ServiceEditMeta) => void
  }
>(function ServiceEditFormInner(props, ref) {
  const { service, categories, inputBase, busy, error, onClose, onSave, onOptimistic, onToast, onMetaChange } = props

  const fileRef = useRef<HTMLInputElement | null>(null)

  // Form state
  const [name, setName] = useState(service.name)
  const [description, setDescription] = useState(service.description ?? '')
  const [categoryId, setCategoryId] = useState(service.categoryId ?? '')
  const [defaultDurationMinutes, setDefaultDurationMinutes] = useState(service.defaultDurationMinutes ? String(service.defaultDurationMinutes) : '')
  const [minPrice, setMinPrice] = useState(service.minPrice ?? '')
  const [allowMobile, setAllowMobile] = useState(Boolean(service.allowMobile))
  const [isActive, setIsActive] = useState(Boolean(service.isActive))
  const [isAddOnEligible, setIsAddOnEligible] = useState(Boolean(service.isAddOnEligible))
  const [addOnGroup, setAddOnGroup] = useState(service.addOnGroup ?? '')
  const [defaultImageUrl, setDefaultImageUrl] = useState<string | null>(service.defaultImageUrl ?? null)

  const [uploadBusy, setUploadBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  // Reset when switching services
  useEffect(() => {
    setName(service.name)
    setDescription(service.description ?? '')
    setCategoryId(service.categoryId ?? '')
    setDefaultDurationMinutes(service.defaultDurationMinutes ? String(service.defaultDurationMinutes) : '')
    setMinPrice(service.minPrice ?? '')
    setAllowMobile(Boolean(service.allowMobile))
    setIsActive(Boolean(service.isActive))
    setIsAddOnEligible(Boolean(service.isAddOnEligible))
    setAddOnGroup(service.addOnGroup ?? '')
    setDefaultImageUrl(service.defaultImageUrl ?? null)
    setUploadBusy(false)
    setLocalError(null)
  }, [service.id]) // only on id change

  const baseline = useMemo(() => {
    // Baseline snapshot for dirty detection
    return {
      name: service.name ?? '',
      description: service.description ?? '',
      categoryId: service.categoryId ?? '',
      defaultDurationMinutes: service.defaultDurationMinutes ? String(service.defaultDurationMinutes) : '',
      minPrice: service.minPrice ?? '',
      allowMobile: Boolean(service.allowMobile),
      isActive: Boolean(service.isActive),
      isAddOnEligible: Boolean(service.isAddOnEligible),
      addOnGroup: service.addOnGroup ?? '',
      defaultImageUrl: service.defaultImageUrl ?? '',
    }
  }, [service])

  const current = useMemo(() => {
    return {
      name: name.trim(),
      description: description,
      categoryId: categoryId,
      defaultDurationMinutes: defaultDurationMinutes,
      minPrice: minPrice,
      allowMobile,
      isActive,
      isAddOnEligible,
      addOnGroup: addOnGroup,
      defaultImageUrl: (defaultImageUrl ?? '').trim(),
    }
  }, [name, description, categoryId, defaultDurationMinutes, minPrice, allowMobile, isActive, isAddOnEligible, addOnGroup, defaultImageUrl])

  const dirty = useMemo(() => {
    // Compare normalized values
    return (
      current.name !== baseline.name ||
      (current.description ?? '') !== (baseline.description ?? '') ||
      (current.categoryId ?? '') !== (baseline.categoryId ?? '') ||
      (current.defaultDurationMinutes ?? '') !== (baseline.defaultDurationMinutes ?? '') ||
      (current.minPrice ?? '') !== (baseline.minPrice ?? '') ||
      Boolean(current.allowMobile) !== Boolean(baseline.allowMobile) ||
      Boolean(current.isActive) !== Boolean(baseline.isActive) ||
      Boolean(current.isAddOnEligible) !== Boolean(baseline.isAddOnEligible) ||
      (current.addOnGroup ?? '') !== (baseline.addOnGroup ?? '') ||
      (current.defaultImageUrl ?? '') !== (baseline.defaultImageUrl ?? '')
    )
  }, [current, baseline])

  const canSave = useMemo(() => {
    if (busy) return false
    if (uploadBusy) return false
    if (!dirty) return false
    if (!current.name.trim()) return false
    if (!current.categoryId) return false

    const img = current.defaultImageUrl
    if (img && !isAbsoluteHttpUrl(img)) return false

    return true
  }, [busy, uploadBusy, dirty, current.name, current.categoryId, current.defaultImageUrl])

  useEffect(() => {
    onMetaChange({ dirty, canSave, uploadBusy })
  }, [dirty, canSave, uploadBusy, onMetaChange])

  async function uploadDefaultImage(file: File) {
    setUploadBusy(true)
    setLocalError(null)

    try {
      if (!file.type.startsWith('image/')) {
        const msg = 'Please choose an image file.'
        setLocalError(msg)
        onToast({ tone: 'error', title: 'Not an image', body: msg })
        return
      }

      const initRes = await fetch('/api/admin/uploads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'SERVICE_DEFAULT_IMAGE_PUBLIC',
          serviceId: service.id,
          contentType: file.type,
          size: file.size,
        }),
      })

      const init = await safeJson(initRes)
      if (!initRes.ok || init?.ok !== true) throw new Error(init?.error || `Upload init failed (${initRes.status}).`)

      const bucket = String(init.bucket || '')
      const path = String(init.path || '')
      const token = String(init.token || '')
      const publicUrl = String(init.publicUrl || '')
      const cacheBuster = typeof init.cacheBuster === 'number' ? init.cacheBuster : null

      if (!bucket || !path || !token) throw new Error('Upload init missing bucket/path/token.')
      if (!publicUrl) throw new Error('Upload init missing publicUrl.')

      const { error: upErr } = await supabaseBrowser.storage.from(bucket).uploadToSignedUrl(path, token, file, {
        contentType: file.type,
        upsert: true,
      })
      if (upErr) throw new Error(upErr.message || 'Upload failed.')

      const finalUrl = withCacheBuster(publicUrl, cacheBuster)

      // Update modal + hero card immediately (still requires Save to persist)
      setDefaultImageUrl(finalUrl)
      onOptimistic({ defaultImageUrl: finalUrl })

      onToast({ tone: 'success', title: 'Image uploaded', body: 'Hit Save to persist it.' }, 2200)
    } catch (e: any) {
      const msg = e?.message || 'Failed to upload image.'
      setLocalError(msg)
      onToast({ tone: 'error', title: 'Upload failed', body: msg })
    } finally {
      setUploadBusy(false)
    }
  }

  function submit() {
    setLocalError(null)

    const cleanName = name.trim()
    if (!cleanName) return

    const img = (defaultImageUrl ?? '').trim()
    if (img && !isAbsoluteHttpUrl(img)) {
      setLocalError('Image URL looks invalid.')
      onToast({ tone: 'error', title: 'Invalid image URL', body: 'That URL doesn’t look valid.' })
      return
    }

    onSave({
      name: cleanName,
      description: description.trim() || '',
      categoryId: categoryId || '',
      defaultDurationMinutes: defaultDurationMinutes || '',
      minPrice: minPrice || '',
      allowMobile: allowMobile ? 'true' : 'false',
      isActive: isActive ? 'true' : 'false',
      isAddOnEligible: isAddOnEligible ? 'true' : 'false',
      addOnGroup: addOnGroup.trim() || '',
      defaultImageUrl: img || '',
    })
  }

  useImperativeHandle(ref, () => ({ submit }), [submit])

  return (
    <div className="relative p-4">
      <div className="grid gap-3">
        {/* Image row */}
        <div className="grid gap-2 rounded-2xl border border-white/10 bg-bgPrimary/25 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-extrabold text-textSecondary">Service image (app-wide)</div>
              <div className="mt-0.5 text-[11px] text-textSecondary">Fallback image if pros don’t upload one.</div>
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] || null
                  if (!f) return
                  haptic(8)
                  void uploadDefaultImage(f)
                  e.currentTarget.value = ''
                }}
              />

              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full border border-surfaceGlass/15 bg-bgPrimary/35 px-3 py-2 text-xs font-extrabold text-textPrimary transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 hover:border-surfaceGlass/25 hover:bg-bgPrimary/45"
                disabled={busy || uploadBusy}
                onClick={() => {
                  haptic(6)
                  fileRef.current?.click()
                }}
              >
                {uploadBusy ? 'Uploading…' : 'Upload image'}
              </button>

              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full border border-toneDanger/35 bg-bgPrimary/35 px-3 py-2 text-xs font-extrabold text-toneDanger transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 hover:border-toneDanger/55 hover:bg-toneDanger/10"
                disabled={busy || uploadBusy || !defaultImageUrl}
                onClick={() => {
                  haptic(8)
                  setDefaultImageUrl(null)
                  onOptimistic({ defaultImageUrl: null })
                  onToast({ tone: 'success', title: 'Image removed', body: 'Hit Save to persist it.' }, 2000)
                }}
              >
                Remove
              </button>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-bgPrimary/20">
            {defaultImageUrl ? (
              <ImageWithShimmer src={defaultImageUrl} className="aspect-[16/10] w-full" />
            ) : (
              <div className="grid aspect-[16/10] w-full place-items-center text-xs font-extrabold text-textSecondary">No image</div>
            )}
          </div>

          {defaultImageUrl ? <div className="break-all text-[11px] text-textSecondary">{defaultImageUrl}</div> : null}
        </div>

        <label className="grid gap-1">
          <div className="text-xs font-extrabold text-textSecondary">Name</div>
          <input className={inputBase} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} />
        </label>

        <label className="grid gap-1">
          <div className="text-xs font-extrabold text-textSecondary">Category</div>
          <select className={inputBase} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={busy}>
            <option value="" disabled>
              Select category
            </option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.parentId ? '↳ ' : ''}
                {c.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            <div className="text-xs font-extrabold text-textSecondary">Min price</div>
            <input
              className={inputBase}
              value={minPrice}
              onChange={(e) => setMinPrice(e.target.value)}
              disabled={busy}
              inputMode="decimal"
              placeholder="e.g. 45 or 45.00"
            />
          </label>

          <label className="grid gap-1">
            <div className="text-xs font-extrabold text-textSecondary">Default minutes</div>
            <input
              className={inputBase}
              value={defaultDurationMinutes}
              onChange={(e) => setDefaultDurationMinutes(e.target.value)}
              disabled={busy}
              inputMode="numeric"
              placeholder="e.g. 60"
            />
          </label>
        </div>

        <label className="grid gap-1">
          <div className="text-xs font-extrabold text-textSecondary">Description</div>
          <textarea
            className={inputBase}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            rows={3}
            placeholder="Client-friendly description that appears across the platform."
          />
        </label>

        <div className="grid gap-3 rounded-2xl border border-white/10 bg-bgPrimary/25 p-3">
          <div className="text-xs font-extrabold text-textSecondary">Flags</div>

          <label className="flex items-center gap-2 text-sm text-textPrimary">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              disabled={busy}
              className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
            />
            <span className="font-bold text-textSecondary">Active</span>
          </label>

          <label className="flex items-center gap-2 text-sm text-textPrimary">
            <input
              type="checkbox"
              checked={allowMobile}
              onChange={(e) => setAllowMobile(e.target.checked)}
              disabled={busy}
              className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
            />
            <span className="font-bold text-textSecondary">Allow mobile</span>
          </label>

          <label className="flex items-center gap-2 text-sm text-textPrimary">
            <input
              type="checkbox"
              checked={isAddOnEligible}
              onChange={(e) => setIsAddOnEligible(e.target.checked)}
              disabled={busy}
              className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
            />
            <span className="font-bold text-textSecondary">Add-on eligible</span>
          </label>

          <label className="grid gap-1">
            <div className="text-xs font-extrabold text-textSecondary">Add-on group (optional)</div>
            <input
              className={inputBase}
              value={addOnGroup}
              onChange={(e) => setAddOnGroup(e.target.value)}
              disabled={busy || !isAddOnEligible}
              placeholder="Finish, Treatment, Upgrade…"
            />
          </label>
        </div>

        {localError ? <div className="text-sm text-toneDanger">{localError}</div> : null}
        {error ? <div className="text-sm text-toneDanger">{error}</div> : null}

        {/* Spacer so last field isn’t cramped against bottom */}
        <div className="h-8" />

        {/* Tiny footer hint (optional, subtle) */}
        <div className="text-[11px] text-textSecondary/80">
          Tip: Save is in the header so your fixed footer nav can’t steal it again.
        </div>

        <button type="button" onClick={onClose} className="hidden" aria-hidden="true" />
      </div>
    </div>
  )
})

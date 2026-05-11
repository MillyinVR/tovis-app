// app/admin/services/_components/ServiceHeroGrid.tsx
'use client'

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ReactNode, RefObject } from 'react'
import { useRouter } from 'next/navigation'
import { AnimatePresence, motion } from 'framer-motion'
import { supabaseBrowser } from '@/lib/supabaseBrowser'

import { cn } from '@/lib/utils'
import {
  safeJson,
  readErrorMessage,
  errorMessageFromUnknown,
  isOkTrue,
} from '@/lib/http'
import { withCacheBuster } from '@/lib/url'

type CategoryDTO = {
  id: string
  name: string
  parentId: string | null
}

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

type ToastState = {
  tone: 'success' | 'error'
  title: string
  body?: string | null
}

type FormMeta = {
  dirty: boolean
  canSave: boolean
  uploadBusy: boolean
}

type FormHandle = {
  submit: () => void
}

type SavePayload = Record<string, string>

function isAbsoluteHttpUrl(input: string): boolean {
  try {
    const url = new URL(input)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function fmtMinutes(value: number | null): string {
  if (!value || !Number.isFinite(value) || value <= 0) return '—'
  if (value < 60) return `${value}m`

  const hours = Math.floor(value / 60)
  const minutes = value % 60

  return minutes ? `${hours}h ${minutes}m` : `${hours}h`
}

function fmtMoney(value: string | null): string {
  const raw = (value ?? '').trim()
  if (!raw) return '—'

  const amount = Number(raw)
  if (!Number.isFinite(amount)) return `$${raw}`

  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(amount)
}

function haptic(ms = 8): void {
  try {
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.vibrate === 'function'
    ) {
      navigator.vibrate(ms)
    }
  } catch {
    // Best-effort only.
  }
}

function Chip({ children }: { children: ReactNode }) {
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
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-black',
        tone,
      )}
    >
      {label}
    </span>
  )
}

function useLockBodyScroll(locked: boolean): void {
  useEffect(() => {
    if (!locked) return

    const previousOverflow = document.body.style.overflow
    const previousPaddingRight = document.body.style.paddingRight
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth

    document.body.style.overflow = 'hidden'
    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`
    }

    return () => {
      document.body.style.overflow = previousOverflow
      document.body.style.paddingRight = previousPaddingRight
    }
  }, [locked])
}

function useModalA11y<T extends HTMLElement>(args: {
  isOpen: boolean
  panelRef: RefObject<T | null>
  onClose: () => void
}): void {
  const { isOpen, panelRef, onClose } = args
  const lastActiveRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!isOpen) return

    const active = document.activeElement
    lastActiveRef.current = active instanceof HTMLElement ? active : null

    const panel = panelRef.current
    if (!panel) return

    const focusable = getFocusable(panel)
    const first = focusable[0] ?? panel

    const timer = window.setTimeout(() => {
      first.focus()
    }, 0)

    return () => window.clearTimeout(timer)
  }, [isOpen, panelRef])

  useEffect(() => {
    if (!isOpen) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== 'Tab') return

      const panel = panelRef.current
      if (!panel) return

      const focusable = getFocusable(panel)
      if (!focusable.length) {
        event.preventDefault()
        panel.focus()
        return
      }

      const active =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null

      const first = focusable[0]
      const last = focusable[focusable.length - 1]

      if (active && !panel.contains(active)) {
        event.preventDefault()
        first.focus()
        return
      }

      if (event.shiftKey) {
        if (active === first) {
          event.preventDefault()
          last.focus()
        }
      } else if (active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, panelRef, onClose])

  useEffect(() => {
    if (isOpen) return

    const element = lastActiveRef.current
    if (element) element.focus()
  }, [isOpen])
}

function getFocusable(root: HTMLElement | null): HTMLElement[] {
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

  return nodes.filter(
    (node) =>
      !node.hasAttribute('disabled') && node.tabIndex !== -1 && isVisible(node),
  )
}

function isVisible(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect()
  return Boolean(rect.width || rect.height)
}

function ImageWithShimmer(props: {
  src: string
  alt?: string
  className?: string
}) {
  const { src, alt = '', className } = props
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  const loaded = loadedSrc === src
  const failed = failedSrc === src

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {!loaded && !failed ? (
        <div className="absolute inset-0">
          <div className="absolute inset-0 animate-pulse bg-bgPrimary/35" />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(120px_120px_at_20%_18%,rgb(255_255_255/0.10),transparent_60%)]" />
          <div className="pointer-events-none absolute inset-0 translate-x-[-60%] animate-[shimmer_1.2s_infinite] bg-[linear-gradient(90deg,transparent,rgb(255_255_255/0.08),transparent)]" />
        </div>
      ) : null}

      {!failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={src}
          src={src}
          alt={alt}
          className={cn(
            'relative z-[1] h-full w-full object-cover transition-opacity',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
          loading="lazy"
          onLoad={() => {
            setFailedSrc((current) => (current === src ? null : current))
            setLoadedSrc(src)
          }}
          onError={() => {
            setLoadedSrc((current) => (current === src ? null : current))
            setFailedSrc(src)
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

function Toast(props: ToastState) {
  const toneClasses =
    props.tone === 'success'
      ? 'border-[rgb(var(--tone-success))/0.25] bg-[rgb(var(--tone-success))/0.10]'
      : 'border-[rgb(var(--tone-danger))/0.25] bg-[rgb(var(--tone-danger))/0.10]'

  return (
    <div
      className={cn(
        'rounded-2xl border px-4 py-3 shadow-[0_24px_90px_rgb(0_0_0/0.55)] backdrop-blur-xl',
        'tovis-glass-strong tovis-noise',
        toneClasses,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="text-sm font-black text-textPrimary">{props.title}</div>
      {props.body ? (
        <div className="mt-0.5 text-xs text-textSecondary">{props.body}</div>
      ) : null}
    </div>
  )
}

type UploadInitOk = {
  ok: true
  bucket: string
  path: string
  token: string
  publicUrl: string
  cacheBuster?: number
}

function parseUploadInit(value: unknown): UploadInitOk | null {
  if (!isOkTrue(value)) return null

  const bucket = typeof value.bucket === 'string' ? value.bucket : ''
  const path = typeof value.path === 'string' ? value.path : ''
  const token = typeof value.token === 'string' ? value.token : ''
  const publicUrl = typeof value.publicUrl === 'string' ? value.publicUrl : ''
  const cacheBuster =
    typeof value.cacheBuster === 'number' && Number.isFinite(value.cacheBuster)
      ? value.cacheBuster
      : undefined

  if (!bucket || !path || !token || !publicUrl) return null

  return {
    ok: true,
    bucket,
    path,
    token,
    publicUrl,
    cacheBuster,
  }
}

function buildServiceBaseline(service: ServiceDTO) {
  return {
    name: service.name.trim(),
    description: service.description ?? '',
    categoryId: service.categoryId ?? '',
    defaultDurationMinutes: service.defaultDurationMinutes
      ? String(service.defaultDurationMinutes)
      : '',
    minPrice: service.minPrice ?? '',
    allowMobile: Boolean(service.allowMobile),
    isActive: Boolean(service.isActive),
    isAddOnEligible: Boolean(service.isAddOnEligible),
    addOnGroup: service.addOnGroup ?? '',
    defaultImageUrl: service.defaultImageUrl ?? '',
  }
}

export default function ServiceHeroGrid(props: {
  services: ServiceDTO[]
  categories: CategoryDTO[]
}) {
  const { services, categories } = props
  const router = useRouter()

  const [servicesSnapshot, setServicesSnapshot] = useState(services)
  const [liveServices, setLiveServices] = useState<ServiceDTO[]>(services)

  if (servicesSnapshot !== services) {
    setServicesSnapshot(services)
    setLiveServices(services)
  }

  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [meta, setMeta] = useState<FormMeta>({
    dirty: false,
    canSave: false,
    uploadBusy: false,
  })
  const [toast, setToast] = useState<ToastState | null>(null)

  const toastTimer = useRef<number | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const formRef = useRef<FormHandle | null>(null)

  const current = useMemo(
    () => liveServices.find((service) => service.id === openId) ?? null,
    [openId, liveServices],
  )

  const isOpen = Boolean(current)

  useLockBodyScroll(isOpen)

  const showToast = useCallback((next: ToastState, ms = 2400) => {
    setToast(next)

    if (toastTimer.current) {
      window.clearTimeout(toastTimer.current)
    }

    toastTimer.current = window.setTimeout(() => {
      setToast(null)
    }, ms)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimer.current) {
        window.clearTimeout(toastTimer.current)
      }
    }
  }, [])

  const close = useCallback(() => {
    if (busy) return

    setOpenId(null)
    setError(null)
    setMeta({
      dirty: false,
      canSave: false,
      uploadBusy: false,
    })
  }, [busy])

  useModalA11y({
    isOpen,
    panelRef,
    onClose: close,
  })

  const patchLiveService = useCallback(
    (id: string, patch: Partial<ServiceDTO>) => {
      setLiveServices((prev) =>
        prev.map((service) =>
          service.id === id ? { ...service, ...patch } : service,
        ),
      )
    },
    [],
  )

  const save = useCallback(
    async (id: string, payload: SavePayload) => {
      setBusy(true)
      setError(null)

      try {
        const form = new FormData()
        form.set('_method', 'PATCH')

        for (const [key, value] of Object.entries(payload)) {
          form.set(key, value)
        }

        const res = await fetch(`/api/admin/services/${encodeURIComponent(id)}`, {
          method: 'POST',
          body: form,
        })

        const data = await safeJson(res)
        const ok = res.ok && isOkTrue(data)

        if (!ok) {
          const message = readErrorMessage(data) ?? `Save failed (${res.status}).`
          setError(message)
          showToast({
            tone: 'error',
            title: 'Save failed',
            body: message,
          })
          return
        }

        showToast(
          {
            tone: 'success',
            title: 'Saved',
            body: 'Service updated successfully.',
          },
          2000,
        )

        setMeta((currentMeta) => ({
          ...currentMeta,
          dirty: false,
          canSave: false,
        }))
        setOpenId(null)
        router.refresh()
      } catch (e: unknown) {
        setError('Network error while saving.')
        showToast({
          tone: 'error',
          title: 'Network error',
          body: errorMessageFromUnknown(e),
        })
      } finally {
        setBusy(false)
      }
    },
    [router, showToast],
  )

  const handleOptimisticPatch = useCallback(
    (patch: Partial<ServiceDTO>) => {
      if (!current) return
      patchLiveService(current.id, patch)
    },
    [current, patchLiveService],
  )

  const handleSaveCurrent = useCallback(
    (payload: SavePayload) => {
      if (!current) return
      void save(current.id, payload)
    },
    [current, save],
  )

  const overlayFade = {
    initial: { opacity: 0 },
    animate: {
      opacity: 1,
      transition: { duration: 0.18, ease: 'easeOut' },
    },
    exit: {
      opacity: 0,
      transition: { duration: 0.14, ease: 'easeIn' },
    },
  } as const

  const panelSlide = {
    initial: {
      opacity: 0,
      y: 18,
      scale: 0.996,
    },
    animate: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        type: 'spring',
        stiffness: 380,
        damping: 34,
        mass: 0.9,
      },
    },
    exit: {
      opacity: 0,
      y: 14,
      transition: { duration: 0.14, ease: 'easeIn' },
    },
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
      <AnimatePresence>
        {toast ? (
          <motion.div
            key="toast"
            className="fixed right-3 top-3 z-[9999] w-[min(380px,calc(100vw-24px))]"
            initial={{
              opacity: 0,
              y: -10,
              scale: 0.995,
            }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              transition: {
                type: 'spring',
                stiffness: 420,
                damping: 34,
              },
            }}
            exit={{
              opacity: 0,
              y: -10,
              transition: { duration: 0.16 },
            }}
          >
            <Toast
              tone={toast.tone}
              title={toast.title}
              body={toast.body ?? null}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {liveServices.map((service) => (
          <div
            key={service.id}
            className={cn(
              'relative overflow-hidden rounded-card border border-surfaceGlass/10 bg-bgSecondary',
              'shadow-[0_18px_50px_rgb(0_0_0/0.45)]',
            )}
          >
            <div
              className={cn(
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
                {service.defaultImageUrl ? (
                  <ImageWithShimmer
                    src={service.defaultImageUrl}
                    className="aspect-[16/10] w-full"
                  />
                ) : (
                  <div className="grid aspect-[16/10] w-full place-items-center text-xs font-extrabold text-textSecondary">
                    No image
                  </div>
                )}
              </div>

              <div className="mt-3 grid gap-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-black text-textPrimary">
                      {service.name}
                    </div>
                    <div className="mt-0.5 text-[12px] font-extrabold text-textSecondary">
                      {service.categoryName ?? '— Category'}
                    </div>
                  </div>

                  <Chip>{service.isActive ? 'Active' : 'Disabled'}</Chip>
                </div>

                <div className="text-[12px] text-textSecondary">
                  {service.description?.trim()
                    ? service.description
                    : 'No description yet. Add one so this reads like a real catalog.'}
                </div>

                <div className="flex flex-wrap gap-2 pt-1">
                  <Chip>Min {fmtMoney(service.minPrice)}</Chip>
                  <Chip>Default {fmtMinutes(service.defaultDurationMinutes)}</Chip>
                  {service.allowMobile ? <Chip>Mobile</Chip> : <Chip>Salon-only</Chip>}
                  {service.isAddOnEligible ? (
                    <Chip>
                      Add-on{service.addOnGroup ? ` • ${service.addOnGroup}` : ''}
                    </Chip>
                  ) : null}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <div className="text-[11px] text-textSecondary">
                  App image:{' '}
                  <span className="font-extrabold">defaultImageUrl</span>
                </div>

                <button
                  type="button"
                  className={cn(btnBase, btnAccent)}
                  onClick={() => {
                    haptic(8)
                    setOpenId(service.id)
                  }}
                >
                  Edit
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      <AnimatePresence>
        {current ? (
          <motion.div
            key="svc-edit"
            className="fixed inset-0 z-[9000]"
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <motion.button
              type="button"
              aria-label="Close"
              onClick={close}
              className="absolute inset-0 bg-black/80 backdrop-blur-lg"
              variants={overlayFade}
            />

            <div className="absolute inset-0 z-[9001] flex items-end justify-center px-2 sm:items-start sm:px-3 sm:pt-10">
              <motion.div
                ref={panelRef}
                variants={panelSlide}
                role="dialog"
                aria-modal="true"
                aria-label={`Edit service: ${current.name}`}
                tabIndex={-1}
                className={cn(
                  'relative flex w-full max-w-3xl flex-col overflow-hidden outline-none',
                  'tovis-glass-strong tovis-noise',
                  'rounded-t-[26px] border border-white/12 sm:rounded-[26px]',
                  'shadow-[0_50px_160px_rgb(0_0_0/0.78)]',
                  'max-h-[calc(100vh-12px)] sm:max-h-[calc(100vh-80px)]',
                )}
              >
                <div className="pointer-events-none absolute inset-0 tovis-overlay-scrim" />
                <div className="pointer-events-none absolute inset-0 ring-1 ring-white/10" />

                <div className="relative z-[2] flex items-start justify-between gap-3 border-b border-white/10 bg-bgSecondary/70 px-4 py-3 backdrop-blur-xl">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-[14px] font-black tracking-[0.04em] text-textPrimary">
                        Edit service
                      </div>
                      <StatusPill dirty={meta.dirty} saving={busy} />
                    </div>
                    <div className="mt-0.5 truncate text-[12px] text-textSecondary">
                      {current.name}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className={cn(btnBase, btnPrimary)}
                      disabled={!meta.canSave || busy || meta.uploadBusy}
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
                      className={cn(btnBase, btnSoft)}
                    >
                      Close
                    </button>
                  </div>
                </div>

                <div className="relative z-[1] flex-1 overflow-y-auto overscroll-contain">
                  <ServiceEditForm
                    key={current.id}
                    ref={formRef}
                    service={current}
                    categories={categories}
                    inputBase={inputBase}
                    busy={busy}
                    error={error}
                    onToast={showToast}
                    onOptimistic={handleOptimisticPatch}
                    onMetaChange={setMeta}
                    onSave={handleSaveCurrent}
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

const ServiceEditForm = forwardRef<
  FormHandle,
  {
    service: ServiceDTO
    categories: CategoryDTO[]
    inputBase: string
    busy: boolean
    error: string | null
    onSave: (payload: SavePayload) => void
    onOptimistic: (patch: Partial<ServiceDTO>) => void
    onToast: (toast: ToastState, ms?: number) => void
    onMetaChange: (meta: FormMeta) => void
  }
>(function ServiceEditFormInner(props, ref) {
  const {
    service,
    categories,
    inputBase,
    busy,
    error,
    onSave,
    onOptimistic,
    onToast,
    onMetaChange,
  } = props

  const fileRef = useRef<HTMLInputElement | null>(null)
  const baselineRef = useRef(buildServiceBaseline(service))

  const [name, setName] = useState(service.name)
  const [description, setDescription] = useState(service.description ?? '')
  const [categoryId, setCategoryId] = useState(service.categoryId ?? '')
  const [defaultDurationMinutes, setDefaultDurationMinutes] = useState(
    service.defaultDurationMinutes ? String(service.defaultDurationMinutes) : '',
  )
  const [minPrice, setMinPrice] = useState(service.minPrice ?? '')
  const [allowMobile, setAllowMobile] = useState(Boolean(service.allowMobile))
  const [isActive, setIsActive] = useState(Boolean(service.isActive))
  const [isAddOnEligible, setIsAddOnEligible] = useState(
    Boolean(service.isAddOnEligible),
  )
  const [addOnGroup, setAddOnGroup] = useState(service.addOnGroup ?? '')
  const [defaultImageUrl, setDefaultImageUrl] = useState<string | null>(
    service.defaultImageUrl ?? null,
  )
  const [uploadBusy, setUploadBusy] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const dirty = useMemo(() => {
    const baseline = baselineRef.current
    const currentImage = (defaultImageUrl ?? '').trim()

    return (
      name.trim() !== baseline.name ||
      description !== baseline.description ||
      categoryId !== baseline.categoryId ||
      defaultDurationMinutes !== baseline.defaultDurationMinutes ||
      minPrice !== baseline.minPrice ||
      Boolean(allowMobile) !== Boolean(baseline.allowMobile) ||
      Boolean(isActive) !== Boolean(baseline.isActive) ||
      Boolean(isAddOnEligible) !== Boolean(baseline.isAddOnEligible) ||
      addOnGroup !== baseline.addOnGroup ||
      currentImage !== baseline.defaultImageUrl
    )
  }, [
    name,
    description,
    categoryId,
    defaultDurationMinutes,
    minPrice,
    allowMobile,
    isActive,
    isAddOnEligible,
    addOnGroup,
    defaultImageUrl,
  ])

  const canSave = useMemo(() => {
    if (busy) return false
    if (uploadBusy) return false
    if (!dirty) return false
    if (!name.trim()) return false
    if (!categoryId) return false

    const image = (defaultImageUrl ?? '').trim()
    if (image && !isAbsoluteHttpUrl(image)) return false

    return true
  }, [busy, uploadBusy, dirty, name, categoryId, defaultImageUrl])

  useEffect(() => {
    onMetaChange({
      dirty,
      canSave,
      uploadBusy,
    })
  }, [dirty, canSave, uploadBusy, onMetaChange])

  const uploadDefaultImage = useCallback(
    async (file: File) => {
      setUploadBusy(true)
      setLocalError(null)

      try {
        if (!file.type.startsWith('image/')) {
          const message = 'Please choose an image file.'
          setLocalError(message)
          onToast({
            tone: 'error',
            title: 'Not an image',
            body: message,
          })
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

        const initRaw = await safeJson(initRes)
        const init = parseUploadInit(initRaw)

        if (!initRes.ok || !init) {
          const message =
            readErrorMessage(initRaw) ?? `Upload init failed (${initRes.status}).`
          throw new Error(message)
        }

        const { error: uploadError } = await supabaseBrowser.storage
          .from(init.bucket)
          .uploadToSignedUrl(init.path, init.token, file, {
            contentType: file.type,
            upsert: true,
          })

        if (uploadError) {
          throw new Error(uploadError.message || 'Upload failed.')
        }

        const finalUrl = withCacheBuster(init.publicUrl, init.cacheBuster)

        setDefaultImageUrl(finalUrl)
        onOptimistic({ defaultImageUrl: finalUrl })

        onToast(
          {
            tone: 'success',
            title: 'Image uploaded',
            body: 'Save is now enabled — hit it to persist.',
          },
          2200,
        )
      } catch (e: unknown) {
        const message = errorMessageFromUnknown(e)
        setLocalError(message)
        onToast({
          tone: 'error',
          title: 'Upload failed',
          body: message,
        })
      } finally {
        setUploadBusy(false)
      }
    },
    [onOptimistic, onToast, service.id],
  )

  const submit = useCallback(() => {
    setLocalError(null)

    const cleanName = name.trim()
    if (!cleanName) return

    const image = (defaultImageUrl ?? '').trim()

    if (image && !isAbsoluteHttpUrl(image)) {
      const message = 'That URL doesn’t look valid.'
      setLocalError('Image URL looks invalid.')
      onToast({
        tone: 'error',
        title: 'Invalid image URL',
        body: message,
      })
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
      defaultImageUrl: image || '',
    })
  }, [
    name,
    defaultImageUrl,
    description,
    categoryId,
    defaultDurationMinutes,
    minPrice,
    allowMobile,
    isActive,
    isAddOnEligible,
    addOnGroup,
    onSave,
    onToast,
  ])

  useImperativeHandle(ref, () => ({ submit }), [submit])

  return (
    <div className="relative p-4">
      <div className="grid gap-3">
        <div className="grid gap-2 rounded-2xl border border-white/10 bg-bgPrimary/25 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-xs font-extrabold text-textSecondary">
                Service image (app-wide)
              </div>
              <div className="mt-0.5 text-[11px] text-textSecondary">
                Fallback image if pros don’t upload one.
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null
                  if (!file) return

                  haptic(8)
                  void uploadDefaultImage(file)
                  event.currentTarget.value = ''
                }}
              />

              <button
                type="button"
                className="inline-flex items-center justify-center rounded-full border border-surfaceGlass/15 bg-bgPrimary/35 px-3 py-2 text-xs font-extrabold text-textPrimary transition hover:border-surfaceGlass/25 hover:bg-bgPrimary/45 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
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
                className="inline-flex items-center justify-center rounded-full border border-toneDanger/35 bg-bgPrimary/35 px-3 py-2 text-xs font-extrabold text-toneDanger transition hover:border-toneDanger/55 hover:bg-toneDanger/10 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busy || uploadBusy || !defaultImageUrl}
                onClick={() => {
                  haptic(8)
                  setDefaultImageUrl(null)
                  onOptimistic({ defaultImageUrl: null })
                  onToast(
                    {
                      tone: 'success',
                      title: 'Image removed',
                      body: 'Save to persist.',
                    },
                    2000,
                  )
                }}
              >
                Remove
              </button>
            </div>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-bgPrimary/20">
            {defaultImageUrl ? (
              <ImageWithShimmer
                src={defaultImageUrl}
                className="aspect-[16/10] w-full"
              />
            ) : (
              <div className="grid aspect-[16/10] w-full place-items-center text-xs font-extrabold text-textSecondary">
                No image
              </div>
            )}
          </div>

          {defaultImageUrl ? (
            <div className="break-all text-[11px] text-textSecondary">
              {defaultImageUrl}
            </div>
          ) : null}
        </div>

        <label className="grid gap-1">
          <div className="text-xs font-extrabold text-textSecondary">Name</div>
          <input
            className={inputBase}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
          />
        </label>

        <label className="grid gap-1">
          <div className="text-xs font-extrabold text-textSecondary">
            Category
          </div>
          <select
            className={inputBase}
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
            disabled={busy}
          >
            <option value="" disabled>
              Select category
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.parentId ? '↳ ' : ''}
                {category.name}
              </option>
            ))}
          </select>
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1">
            <div className="text-xs font-extrabold text-textSecondary">
              Min price
            </div>
            <input
              className={inputBase}
              value={minPrice}
              onChange={(event) => setMinPrice(event.target.value)}
              disabled={busy}
              inputMode="decimal"
            />
          </label>

          <label className="grid gap-1">
            <div className="text-xs font-extrabold text-textSecondary">
              Default minutes
            </div>
            <input
              className={inputBase}
              value={defaultDurationMinutes}
              onChange={(event) => setDefaultDurationMinutes(event.target.value)}
              disabled={busy}
              inputMode="numeric"
            />
          </label>
        </div>

        <label className="grid gap-1">
          <div className="text-xs font-extrabold text-textSecondary">
            Description
          </div>
          <textarea
            className={inputBase}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            disabled={busy}
            rows={3}
          />
        </label>

        <div className="grid gap-3 rounded-2xl border border-white/10 bg-bgPrimary/25 p-3">
          <div className="text-xs font-extrabold text-textSecondary">Flags</div>

          <label className="flex items-center gap-2 text-sm text-textPrimary">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => {
                haptic(6)
                setIsActive(event.target.checked)
              }}
              disabled={busy}
              className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
            />
            <span className="font-bold text-textSecondary">Active</span>
          </label>

          <label className="flex items-center gap-2 text-sm text-textPrimary">
            <input
              type="checkbox"
              checked={allowMobile}
              onChange={(event) => {
                haptic(6)
                setAllowMobile(event.target.checked)
              }}
              disabled={busy}
              className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
            />
            <span className="font-bold text-textSecondary">Allow mobile</span>
          </label>

          <label className="flex items-center gap-2 text-sm text-textPrimary">
            <input
              type="checkbox"
              checked={isAddOnEligible}
              onChange={(event) => {
                haptic(6)
                setIsAddOnEligible(event.target.checked)
              }}
              disabled={busy}
              className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
            />
            <span className="font-bold text-textSecondary">
              Add-on eligible
            </span>
          </label>

          <label className="grid gap-1">
            <div className="text-xs font-extrabold text-textSecondary">
              Add-on group (optional)
            </div>
            <input
              className={inputBase}
              value={addOnGroup}
              onChange={(event) => setAddOnGroup(event.target.value)}
              disabled={busy || !isAddOnEligible}
              placeholder="Finish, Treatment, Upgrade…"
            />
          </label>
        </div>

        {localError ? (
          <div className="text-sm text-toneDanger">{localError}</div>
        ) : null}

        {error ? <div className="text-sm text-toneDanger">{error}</div> : null}

        <div className="h-8" />
        <div className="text-[11px] text-textSecondary/80">
          Save lives in the header so the footer can’t steal it again.
        </div>
      </div>
    </div>
  )
})
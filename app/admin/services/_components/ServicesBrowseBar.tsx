// app/admin/services/_components/ServicesBrowseBar.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { isRecord } from '@/lib/guards'
import { pickStringOrEmpty } from '@/lib/pick'
import { cn } from '@/lib/utils'

type CategoryDTO = { id: string; name: string; parentId: string | null }

type PersistedFilters = {
  q: string
  active: '1' | '0'
  cat: string
  kids: '1' | '0'
  per: string
}

type Props = {
  categories: CategoryDTO[]
  // server-derived state (from URL search params)
  initial: {
    q: string
    active: '1' | '0'
    cat: string // categoryId or ''
    kids: '1' | '0'
    per: string
    page: number
  }
  stats: {
    total: number
    totalPages: number
  }
}

const COOKIE_KEY = 'tovis_admin_services_filters'
const LS_KEY = 'tovis_admin_services_filters_v1'

function safeJsonParse(s: string | null): unknown | null {
  if (!s) return null
  try {
    return JSON.parse(s) as unknown
  } catch {
    return null
  }
}

function as01(v: unknown): '0' | '1' | null {
  if (v === '0' || v === 0) return '0'
  if (v === '1' || v === 1) return '1'
  return null
}

function parsePersistedFilters(v: unknown): PersistedFilters | null {
  if (!isRecord(v)) return null

  const q = pickStringOrEmpty(v.q)
  const active = as01(v.active)
  const cat = pickStringOrEmpty(v.cat)
  const kids = as01(v.kids)
  const perRaw = pickStringOrEmpty(v.per)
  const per = perRaw && /^\d+$/.test(perRaw) ? perRaw : '36'

  if (!active || !kids) return null
  return { q, active, cat, kids, per }
}

function getCookie(name: string) {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : null
}

function setCookie(name: string, value: string, days = 120) {
  if (typeof document === 'undefined') return
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString()
  const secure =
    typeof window !== 'undefined' && window.location && window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${name}=${encodeURIComponent(value)}; Expires=${expires}; Path=/; SameSite=Lax${secure}`
}

function buildQS(obj: Record<string, string>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(obj)) {
    if (!v) continue
    sp.set(k, v)
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

function parseActive(v: string): '1' | '0' {
  return v === '0' ? '0' : '1'
}

export default function ServicesBrowseBar({ categories, initial, stats }: Props) {
  const router = useRouter()

  const [q, setQ] = useState(initial.q)
  const [active, setActive] = useState<'1' | '0'>(initial.active)
  const [cat, setCat] = useState(initial.cat)
  const [kids, setKids] = useState<'1' | '0'>(initial.kids)
  const [per, setPer] = useState(initial.per)
  const [jump, setJump] = useState(String(initial.page))

  const [hydrated, setHydrated] = useState(false)

  const categoryOptions = useMemo(() => {
    const byParent = new Map<string, CategoryDTO[]>()
    const tops: CategoryDTO[] = []

    for (const c of categories) {
      if (!c.parentId) tops.push(c)
      else {
        const arr = byParent.get(c.parentId) ?? []
        arr.push(c)
        byParent.set(c.parentId, arr)
      }
    }

    tops.sort((a, b) => a.name.localeCompare(b.name))
    for (const [pid, arr] of byParent) {
      arr.sort((a, b) => a.name.localeCompare(b.name))
      byParent.set(pid, arr)
    }

    const out: Array<{ label: string; value: string }> = [{ label: 'All categories', value: '' }]
    for (const t of tops) {
      out.push({ label: t.name, value: t.id })
      for (const k of byParent.get(t.id) ?? []) out.push({ label: `↳ ${k.name}`, value: k.id })
    }
    return out
  }, [categories])

  function persistFilters(next: PersistedFilters) {
    const payload = JSON.stringify(next)

    // localStorage is best-effort
    try {
      if (typeof window !== 'undefined') localStorage.setItem(LS_KEY, payload)
    } catch {
      // ignore
    }

    setCookie(COOKIE_KEY, payload)
  }

  useEffect(() => {
    const cookieSaved = parsePersistedFilters(safeJsonParse(getCookie(COOKIE_KEY)))

    const lsSaved = (() => {
      try {
        if (typeof window === 'undefined') return null
        return parsePersistedFilters(safeJsonParse(localStorage.getItem(LS_KEY)))
      } catch {
        return null
      }
    })()

    const saved = cookieSaved ?? lsSaved

    const hasMeaningful =
      initial.q.trim() ||
      initial.cat ||
      initial.per !== '36' ||
      initial.active !== '1' ||
      initial.kids !== '1' ||
      initial.page !== 1

    if (!hasMeaningful && saved) {
      setQ(saved.q)
      setActive(saved.active)
      setCat(saved.cat)
      setKids(saved.kids)
      setPer(saved.per)

      const qs = buildQS({
        q: saved.q.trim(),
        active: saved.active,
        cat: saved.cat,
        kids: saved.kids,
        per: saved.per,
        page: '1',
      })

      router.replace(`/admin/services${qs}`)
    }

    setHydrated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function apply() {
    const next: PersistedFilters = { q: q.trim(), active, cat, kids, per }
    persistFilters(next)
    router.push(`/admin/services${buildQS({ ...next, page: '1' })}`)
  }

  function goToPage(n: number) {
    const clamped = Math.max(1, Math.min(stats.totalPages || 1, n))
    const next = {
      q: q.trim(),
      active,
      cat,
      kids,
      per,
      page: String(clamped),
    }
    persistFilters({ q: next.q, active: next.active, cat: next.cat, kids: next.kids, per: next.per })
    router.push(`/admin/services${buildQS(next)}`)
  }

  const inputBase =
    'w-full rounded-xl border border-surfaceGlass/15 bg-bgPrimary/40 px-3 py-2 text-sm text-textPrimary placeholder:text-textSecondary/70 outline-none focus:border-surfaceGlass/30'

  const btnBase =
    'inline-flex items-center justify-center rounded-full px-3 py-2 text-xs font-extrabold transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60'

  const btnSoft = 'border border-surfaceGlass/15 bg-bgSecondary text-textPrimary hover:border-surfaceGlass/25'
  const btnAccent =
    'border border-accentPrimary/45 bg-accentPrimary/15 text-textPrimary hover:border-accentPrimary/60 hover:bg-accentPrimary/18'

  const page = initial.page
  const totalPages = stats.totalPages

  return (
    <div
      className={cn(
        'sticky top-3 z-20',
        'rounded-card border border-surfaceGlass/10 bg-bgSecondary/80 backdrop-blur-xl',
        'shadow-[0_18px_60px_rgb(0_0_0/0.55)]',
      )}
    >
      <div className="p-3">
        <div className="grid gap-3">
          <div className="grid gap-2 lg:grid-cols-[1fr_220px_200px_140px_120px]">
            <input
              className={inputBase}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search services or categories…"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  apply()
                }
              }}
              disabled={!hydrated}
            />

            <select className={inputBase} value={cat} onChange={(e) => setCat(e.target.value)} disabled={!hydrated}>
              {categoryOptions.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>

            <select
              className={inputBase}
              value={active}
              onChange={(e) => setActive(parseActive(e.target.value))}
              disabled={!hydrated}
            >
              <option value="1">Active only</option>
              <option value="0">All (active + disabled)</option>
            </select>

            <select className={inputBase} value={per} onChange={(e) => setPer(e.target.value)} disabled={!hydrated}>
              <option value="12">12 / page</option>
              <option value="24">24 / page</option>
              <option value="36">36 / page</option>
              <option value="60">60 / page</option>
              <option value="120">120 / page</option>
            </select>

            <button type="button" className={cn(btnBase, btnAccent)} onClick={apply} disabled={!hydrated}>
              Apply
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-xs font-black text-textPrimary">
              <input
                type="checkbox"
                checked={kids === '1'}
                onChange={(e) => setKids(e.target.checked ? '1' : '0')}
                className="h-4 w-4 accent-[rgb(var(--accent-primary))]"
                disabled={!hydrated}
              />
              Include subcategories (when selecting a top-level category)
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <div className="text-[11px] font-extrabold text-textSecondary">
                <span className="text-textPrimary">{stats.total}</span> total • Page{' '}
                <span className="text-textPrimary">{page}</span> of{' '}
                <span className="text-textPrimary">{totalPages}</span>
              </div>

              <button
                type="button"
                className={cn(btnBase, btnSoft)}
                onClick={() => goToPage(page - 1)}
                disabled={!hydrated || page <= 1}
              >
                ← Prev
              </button>

              <div className="flex items-center gap-2 rounded-full border border-surfaceGlass/15 bg-bgPrimary/30 px-3 py-1.5">
                <div className="text-[11px] font-extrabold text-textSecondary">Jump</div>
                <input
                  className={cn('w-16 bg-transparent text-xs font-black text-textPrimary outline-none', 'placeholder:text-textSecondary/70')}
                  value={jump}
                  onChange={(e) => setJump(e.target.value)}
                  inputMode="numeric"
                  placeholder="1"
                  disabled={!hydrated}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const n = Number.parseInt(jump, 10)
                      if (Number.isFinite(n)) goToPage(n)
                    }
                  }}
                />
                <button
                  type="button"
                  className={cn(
                    'rounded-full border border-surfaceGlass/15 bg-bgSecondary px-2 py-1 text-[11px] font-extrabold text-textPrimary hover:border-surfaceGlass/25',
                  )}
                  disabled={!hydrated}
                  onClick={() => {
                    const n = Number.parseInt(jump, 10)
                    if (Number.isFinite(n)) goToPage(n)
                  }}
                >
                  Go
                </button>
              </div>

              <button
                type="button"
                className={cn(btnBase, btnSoft)}
                onClick={() => goToPage(page + 1)}
                disabled={!hydrated || page >= totalPages}
              >
                Next →
              </button>
            </div>
          </div>

          <div className="text-[11px] text-textSecondary">Filters are remembered automatically. You’re welcome. 🫶</div>
        </div>
      </div>
    </div>
  )
}
// app/admin/services/_components/ServicesBrowseBar.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

type CategoryDTO = { id: string; name: string; parentId: string | null }

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

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ')
}

const COOKIE_KEY = 'tovis_admin_services_filters'
const LS_KEY = 'tovis_admin_services_filters_v1'

function safeJsonParse<T>(s: string | null): T | null {
  if (!s) return null
  try {
    return JSON.parse(s) as T
  } catch {
    return null
  }
}

function getCookie(name: string) {
  if (typeof document === 'undefined') return null
  const m = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[-[\]/{}()*+?.\\^$|]/g, '\\$&')}=([^;]*)`))
  return m ? decodeURIComponent(m[1]) : null
}

function setCookie(name: string, value: string, days = 120) {
  if (typeof document === 'undefined') return
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString()
  document.cookie = `${name}=${encodeURIComponent(value)}; Expires=${expires}; Path=/; SameSite=Lax`
}

function buildQS(obj: Record<string, string>) {
  const sp = new URLSearchParams()
  Object.entries(obj).forEach(([k, v]) => {
    if (!v) return
    sp.set(k, v)
  })
  const s = sp.toString()
  return s ? `?${s}` : ''
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

  // Build category options with indentation for children
  const categoryOptions = useMemo(() => {
    const byParent = new Map<string, CategoryDTO[]>()
    const tops: CategoryDTO[] = []
    for (const c of categories) {
      if (!c.parentId) tops.push(c)
      else {
        const pid = c.parentId
        const arr = byParent.get(pid) ?? []
        arr.push(c)
        byParent.set(pid, arr)
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
      const kidsArr = byParent.get(t.id) ?? []
      for (const k of kidsArr) out.push({ label: `↳ ${k.name}`, value: k.id })
    }
    return out
  }, [categories])

  // Remember filters (cookie + localStorage)
  function persistFilters(next: { q: string; active: '1' | '0'; cat: string; kids: '1' | '0'; per: string }) {
    const payload = JSON.stringify(next)
    try {
      localStorage.setItem(LS_KEY, payload)
    } catch {}
    setCookie(COOKIE_KEY, payload)
  }

  // On first mount, if the URL is "blank-ish" and we have saved prefs, apply them.
  useEffect(() => {
    const saved =
      safeJsonParse<{ q: string; active: '1' | '0'; cat: string; kids: '1' | '0'; per: string }>(
        getCookie(COOKIE_KEY),
      ) ??
      safeJsonParse<{ q: string; active: '1' | '0'; cat: string; kids: '1' | '0'; per: string }>(
        (() => {
          try {
            return localStorage.getItem(LS_KEY)
          } catch {
            return null
          }
        })(),
      )

    // If user already has meaningful params, don't override them.
    const hasMeaningful =
      initial.q.trim() ||
      initial.cat ||
      initial.per !== '36' ||
      initial.active !== '1' ||
      initial.kids !== '1' ||
      initial.page !== 1

    if (!hasMeaningful && saved) {
      setQ(saved.q ?? '')
      setActive(saved.active ?? '1')
      setCat(saved.cat ?? '')
      setKids(saved.kids ?? '1')
      setPer(saved.per ?? '36')

      // Push remembered filters into URL (page resets)
      const qs = buildQS({
        q: (saved.q ?? '').trim(),
        active: saved.active ?? '1',
        cat: saved.cat ?? '',
        kids: saved.kids ?? '1',
        per: saved.per ?? '36',
        page: '1',
      })
      router.replace(`/admin/services${qs}`)
    }

    setHydrated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function apply() {
    const next = {
      q: q.trim(),
      active,
      cat,
      kids,
      per,
    }
    persistFilters(next)
    const qs = buildQS({ ...next, page: '1' })
    router.push(`/admin/services${qs}`)
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

  const btnSoft =
    'border border-surfaceGlass/15 bg-bgSecondary text-textPrimary hover:border-surfaceGlass/25'

  const btnAccent =
    'border border-accentPrimary/45 bg-accentPrimary/15 text-textPrimary hover:border-accentPrimary/60 hover:bg-accentPrimary/18'

  const page = initial.page
  const totalPages = stats.totalPages

  return (
    <div
      className={cx(
        'sticky top-3 z-20',
        'rounded-card border border-surfaceGlass/10 bg-bgSecondary/80 backdrop-blur-xl',
        'shadow-[0_18px_60px_rgb(0_0_0/0.55)]',
      )}
    >
      <div className="p-3">
        <div className="grid gap-3">
          {/* Filters row */}
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

            <select className={inputBase} value={active} onChange={(e) => setActive(e.target.value as any)} disabled={!hydrated}>
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

            <button type="button" className={cx(btnBase, btnAccent)} onClick={apply} disabled={!hydrated}>
              Apply
            </button>
          </div>

          {/* Kids + pagination row */}
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
                className={cx(btnBase, btnSoft)}
                onClick={() => goToPage(page - 1)}
                disabled={!hydrated || page <= 1}
              >
                ← Prev
              </button>

              <div className="flex items-center gap-2 rounded-full border border-surfaceGlass/15 bg-bgPrimary/30 px-3 py-1.5">
                <div className="text-[11px] font-extrabold text-textSecondary">Jump</div>
                <input
                  className={cx(
                    'w-16 bg-transparent text-xs font-black text-textPrimary outline-none',
                    'placeholder:text-textSecondary/70',
                  )}
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
                  className={cx(
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
                className={cx(btnBase, btnSoft)}
                onClick={() => goToPage(page + 1)}
                disabled={!hydrated || page >= totalPages}
              >
                Next →
              </button>
            </div>
          </div>

          {/* Tiny hint row */}
          <div className="text-[11px] text-textSecondary">
            Filters are remembered automatically. You’re welcome. 🫶
          </div>
        </div>
      </div>
    </div>
  )
}

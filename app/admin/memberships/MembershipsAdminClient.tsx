'use client'

// Search + comp controls for the admin memberships page. Talks to
// /api/v1/admin/memberships (search) and .../memberships/[id]/comp
// (PUT grant / DELETE revoke).

import { useEffect, useState, useTransition } from 'react'

import {
  DEFAULT_TIME_ZONE,
  formatInTimeZone,
  getViewerTimeZone,
} from '@/lib/time'

type DirectoryRow = {
  professionalId: string
  displayLabel: string
  handle: string | null
  contactEmail: string | null
  isPremium: boolean
  effectivePlanKey: string
  paidPlanKey: string
  paidStatus: string | null
  hasStripeSubscription: boolean
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  compPlanKey: string | null
  compUntil: string | null
  compNote: string | null
}

type CameraUsage = {
  used: number
  baseQuota: number
  bonus: number
  quota: number
  remaining: number
  enforced: boolean
}

const COMP_PLANS = ['pro', 'premium', 'studio'] as const
const COMP_MONTHS = [1, 3, 6, 12] as const

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? null
    : formatInTimeZone(d, getViewerTimeZone() ?? DEFAULT_TIME_ZONE, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
}

async function readError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as {
    error?: string
  } | null
  return data?.error || 'Request failed.'
}

export default function MembershipsAdminClient() {
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<DirectoryRow[]>([])
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  async function search(q: string) {
    setError(null)
    try {
      const res = await fetch(
        `/api/v1/admin/memberships?q=${encodeURIComponent(q)}`,
      )
      if (!res.ok) throw new Error(await readError(res))
      const data = (await res.json()) as { items: DirectoryRow[] }
      setItems(data.items)
      setSearched(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Search failed.')
    }
  }

  async function grant(
    professionalId: string,
    planKey: string,
    months: number,
    note: string,
  ) {
    setError(null)
    try {
      const res = await fetch(
        `/api/v1/admin/memberships/${professionalId}/comp`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planKey, months, note: note || undefined }),
        },
      )
      if (!res.ok) throw new Error(await readError(res))
      await search(query)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Grant failed.')
    }
  }

  async function revoke(professionalId: string) {
    setError(null)
    try {
      const res = await fetch(
        `/api/v1/admin/memberships/${professionalId}/comp`,
        { method: 'DELETE' },
      )
      if (!res.ok) throw new Error(await readError(res))
      await search(query)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Revoke failed.')
    }
  }

  return (
    <div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          startTransition(() => search(query))
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by business, name, handle, or email…"
          className="w-full max-w-md rounded-card border border-white/15 bg-bgPrimary px-3 py-2 text-[13px] text-textPrimary placeholder:text-textSecondary focus:border-accentPrimary/60 focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending || query.trim().length < 2}
          className="rounded-card border border-accentPrimary/60 bg-accentPrimary px-4 py-2 text-[12px] font-black text-bgPrimary transition hover:bg-accentPrimaryHover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? 'Searching…' : 'Search'}
        </button>
      </form>

      {error ? (
        <div className="mt-3 text-[12px] text-toneDanger">{error}</div>
      ) : null}

      <div className="mt-5 grid gap-3">
        {items.map((item) => (
          <MembershipRow
            key={item.professionalId}
            item={item}
            busy={pending}
            onGrant={(plan, months, note) =>
              startTransition(() =>
                grant(item.professionalId, plan, months, note),
              )
            }
            onRevoke={() =>
              startTransition(() => revoke(item.professionalId))
            }
          />
        ))}
        {searched && items.length === 0 && !error ? (
          <div className="rounded-card border border-white/10 bg-bgPrimary/40 p-4 text-[13px] text-textSecondary">
            No pros matched that search.
          </div>
        ) : null}
      </div>
    </div>
  )
}

function MembershipRow({
  item,
  busy,
  onGrant,
  onRevoke,
}: {
  item: DirectoryRow
  busy: boolean
  onGrant: (planKey: string, months: number, note: string) => void
  onRevoke: () => void
}) {
  const [planKey, setPlanKey] = useState<string>('pro')
  const [months, setMonths] = useState<number>(3)
  const [note, setNote] = useState('')

  const [usage, setUsage] = useState<CameraUsage | null>(null)
  const [bonusInput, setBonusInput] = useState('')
  const [cameraBusy, setCameraBusy] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(
          `/api/v1/admin/memberships/${item.professionalId}/camera`,
          { cache: 'no-store' },
        )
        if (!res.ok) return
        const data = (await res.json()) as { usage: CameraUsage }
        if (!cancelled) setUsage(data.usage)
      } catch {
        // best-effort readout
      }
    })()
    return () => {
      cancelled = true
    }
  }, [item.professionalId])

  async function grantBonus() {
    const n = Number.parseInt(bonusInput.trim(), 10)
    if (!Number.isInteger(n) || n <= 0) {
      setCameraError('Enter a whole number of images.')
      return
    }
    setCameraBusy(true)
    setCameraError(null)
    try {
      const res = await fetch(
        `/api/v1/admin/memberships/${item.professionalId}/camera`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ count: n }),
        },
      )
      if (!res.ok) {
        setCameraError(await readError(res))
        return
      }
      const data = (await res.json()) as { usage: CameraUsage }
      setUsage(data.usage)
      setBonusInput('')
    } catch {
      setCameraError('Something went wrong.')
    } finally {
      setCameraBusy(false)
    }
  }

  const compLabel = formatDate(item.compUntil)
  const renewLabel = formatDate(item.currentPeriodEnd)

  return (
    <div className="rounded-card border border-white/10 bg-bgPrimary/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="text-[14px] font-black">{item.displayLabel}</span>
          {item.handle ? (
            <span className="ml-2 text-[12px] text-textSecondary">
              @{item.handle}
            </span>
          ) : null}
          {item.contactEmail ? (
            <span className="ml-2 text-[12px] text-textSecondary">
              {item.contactEmail}
            </span>
          ) : null}
        </div>
        <div className="text-[12px] font-black uppercase text-accentPrimary">
          {item.effectivePlanKey}
        </div>
      </div>

      <div className="mt-1 text-[12px] text-textSecondary">
        Paid: {item.paidPlanKey}
        {item.paidStatus ? ` (${item.paidStatus.toLowerCase()})` : ' (no subscription)'}
        {item.hasStripeSubscription && renewLabel
          ? ` · renews ${renewLabel}${item.cancelAtPeriodEnd ? ' (cancelling)' : ''}`
          : ''}
        {item.compPlanKey && compLabel ? (
          <span className="text-toneSuccess">
            {' '}
            · comp {item.compPlanKey} through {compLabel}
            {item.compNote ? ` — “${item.compNote}”` : ''}
          </span>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={planKey}
          onChange={(e) => setPlanKey(e.target.value)}
          className="rounded-card border border-white/15 bg-bgPrimary px-2 py-1.5 text-[12px] text-textPrimary"
          aria-label="Comp plan"
        >
          {COMP_PLANS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
          className="rounded-card border border-white/15 bg-bgPrimary px-2 py-1.5 text-[12px] text-textPrimary"
          aria-label="Comp months"
        >
          {COMP_MONTHS.map((m) => (
            <option key={m} value={m}>
              {m} {m === 1 ? 'month' : 'months'}
            </option>
          ))}
        </select>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="min-w-[160px] flex-1 rounded-card border border-white/15 bg-bgPrimary px-2 py-1.5 text-[12px] text-textPrimary placeholder:text-textSecondary"
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => onGrant(planKey, months, note.trim())}
          className="rounded-card border border-accentPrimary/60 bg-accentPrimary px-3 py-1.5 text-[12px] font-black text-bgPrimary transition hover:bg-accentPrimaryHover disabled:cursor-not-allowed disabled:opacity-60"
        >
          {item.compPlanKey ? 'Extend comp' : 'Grant comp'}
        </button>
        {item.compPlanKey ? (
          <button
            type="button"
            disabled={busy}
            onClick={onRevoke}
            className="rounded-card border border-white/15 bg-bgPrimary px-3 py-1.5 text-[12px] font-black text-toneDanger transition hover:border-white/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Revoke
          </button>
        ) : null}
      </div>

      <div className="mt-3 border-t border-white/10 pt-3">
        <div className="text-[12px] text-textSecondary">
          AI camera this month:{' '}
          {usage ? (
            <span className="text-textPrimary">
              {usage.used}/{usage.quota} used
              {usage.bonus > 0 ? ` (incl. +${usage.bonus} bonus)` : ''} ·{' '}
              {usage.remaining} left
              {!usage.enforced ? ' · metering off' : ''}
            </span>
          ) : (
            '—'
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            value={bonusInput}
            onChange={(e) => setBonusInput(e.target.value)}
            inputMode="numeric"
            placeholder="Bonus images"
            aria-label="Bonus images to grant"
            className="w-32 rounded-card border border-white/15 bg-bgPrimary px-2 py-1.5 text-[12px] text-textPrimary placeholder:text-textSecondary"
          />
          <button
            type="button"
            disabled={cameraBusy}
            onClick={grantBonus}
            className="rounded-card border border-accentPrimary/60 bg-accentPrimary px-3 py-1.5 text-[12px] font-black text-bgPrimary transition hover:bg-accentPrimaryHover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {cameraBusy ? 'Granting…' : 'Grant images'}
          </button>
          {cameraError ? (
            <span className="text-[12px] text-toneDanger">{cameraError}</span>
          ) : null}
        </div>
      </div>
    </div>
  )
}

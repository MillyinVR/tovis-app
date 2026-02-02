// app/pro/calendar/WorkingHoursTabs.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import WorkingHoursForm, { type ApiWorkingHours, type LocationType } from './WorkingHoursForm'

type Props = {
  canSalon: boolean
  canMobile: boolean
  activeLocationType?: LocationType
  onChangeLocationType?: (next: LocationType) => void
  onSavedAny?: () => void
}

/**
 * A safe, explicit default so we never feed `null` into the form.
 * Shape matches the API: mon..sun => { enabled, start, end }
 */
function defaultHours(): ApiWorkingHours {
  const make = (enabled: boolean) => ({ enabled, start: '09:00', end: '17:00' })
  return {
    mon: make(true),
    tue: make(true),
    wed: make(true),
    thu: make(true),
    fri: make(true),
    sat: make(false),
    sun: make(false),
  } as any
}

function isObject(x: unknown): x is Record<string, unknown> {
  return Boolean(x && typeof x === 'object' && !Array.isArray(x))
}

/** Lightweight shape check so “null/garbage” can’t silently become “closed” */
function looksLikeHours(v: unknown): v is ApiWorkingHours {
  if (!isObject(v)) return false
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
  for (const d of days) {
    const row = (v as any)[d]
    if (!isObject(row)) return false
    if (typeof row.enabled !== 'boolean') return false
    if (typeof row.start !== 'string') return false
    if (typeof row.end !== 'string') return false
  }
  return true
}

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

function TabButton({
  active,
  onClick,
  children,
  tone,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  tone: 'salon' | 'mobile'
}) {
  // ✅ token-based (no random emerald literal)
  const accent =
    tone === 'salon'
      ? 'border-accentPrimary/30 bg-accentPrimary/10'
      : 'border-toneInfo/30 bg-toneInfo/10'

  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'relative overflow-hidden rounded-full px-3 py-2 text-[12px] font-extrabold',
        'border transition focus-visible:outline-none',
        'hover:scale-[1.01] active:scale-[0.99] will-change-transform',
        active
          ? `text-textPrimary ${accent} shadow-sm`
          : 'border-white/10 text-textSecondary hover:text-textPrimary hover:border-white/20 hover:bg-bgSecondary/35',
      ].join(' ')}
    >
      {children}
      {active ? <span className="absolute inset-0 pointer-events-none ring-1 ring-white/10" /> : null}
    </button>
  )
}

export default function WorkingHoursTabs({
  canSalon,
  canMobile,
  activeLocationType,
  onChangeLocationType,
  onSavedAny,
}: Props) {
  /**
   * UI tabs:
   * - if they can do salon => show salon tab
   * - if they can do mobile => show mobile tab
   * - otherwise show salon tab (so UI doesn’t die)
   */
  const availableTabs = useMemo(() => {
    const tabs: LocationType[] = []
    if (canSalon) tabs.push('SALON')
    if (canMobile) tabs.push('MOBILE')
    if (!tabs.length) tabs.push('SALON')
    return tabs
  }, [canSalon, canMobile])

  const [localActive, setLocalActive] = useState<LocationType>(availableTabs[0])
  const active: LocationType = activeLocationType ?? localActive

  const setActive = (next: LocationType) => {
    if (onChangeLocationType) onChangeLocationType(next)
    else setLocalActive(next)
  }

  /**
   * ✅ Always keep non-null hours in state.
   * If server gives null/invalid, we fall back to defaults.
   */
  const [initialByMode, setInitialByMode] = useState<Record<LocationType, ApiWorkingHours>>({
    SALON: defaultHours(),
    MOBILE: defaultHours(),
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Keep active tab valid if capabilities change
  useEffect(() => {
    const next = availableTabs.includes(active) ? active : availableTabs[0]
    if (next !== active) setActive(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTabs.join('|')])

  /**
   * ✅ Load BOTH schedules (SALON + MOBILE) whenever possible.
   * Even if UI only shows one tab, the calendar overlay benefits from having both.
   *
   * This prevents the “why do I see nothing?” issue when union logic expects both.
   */
  useEffect(() => {
    let cancelled = false

    async function load(mode: LocationType) {
      const res = await fetch(`/api/pro/working-hours?locationType=${encodeURIComponent(mode)}`, {
        method: 'GET',
        cache: 'no-store',
      })
      const data = await safeJson(res)
      if (!res.ok) throw new Error(data?.error || `Failed to load ${mode} hours.`)

      const raw = data?.workingHours
      return looksLikeHours(raw) ? (raw as ApiWorkingHours) : defaultHours()
    }

    async function loadAll() {
      try {
        setError(null)
        setLoading(true)

        const wantsSalon = canSalon || availableTabs.includes('SALON')
        const wantsMobile = canMobile || availableTabs.includes('MOBILE')

        const [salon, mobile] = await Promise.all([
          wantsSalon ? load('SALON') : Promise.resolve(defaultHours()),
          wantsMobile ? load('MOBILE') : Promise.resolve(defaultHours()),
        ])

        if (cancelled) return

        setInitialByMode((prev) => ({
          ...prev,
          SALON: salon,
          MOBILE: mobile,
        }))
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load hours.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    loadAll()
    return () => {
      cancelled = true
    }
  }, [canSalon, canMobile, availableTabs])

  const showTabs = availableTabs.length > 1

  return (
    <div className="grid gap-3">
      {showTabs && (
        <div className="tovis-glass-soft tovis-noise flex flex-wrap items-center gap-2 px-3 py-2">
          {availableTabs.includes('SALON') && (
            <TabButton active={active === 'SALON'} onClick={() => setActive('SALON')} tone="salon">
              Salon hours
            </TabButton>
          )}
          {availableTabs.includes('MOBILE') && (
            <TabButton active={active === 'MOBILE'} onClick={() => setActive('MOBILE')} tone="mobile">
              Mobile hours
            </TabButton>
          )}

          <div className="ml-auto hidden text-xs font-semibold text-textSecondary md:block">
            Editing:{' '}
            <span className="font-extrabold text-textPrimary">{active === 'SALON' ? 'Salon' : 'Mobile'}</span>
          </div>
        </div>
      )}

      {loading ? <div className="text-[12px] text-textSecondary">Loading schedule…</div> : null}
      {error ? <div className="text-[12px] font-extrabold text-toneDanger">{error}</div> : null}

      <div className="tovis-glass-soft tovis-noise p-4">
        <WorkingHoursForm
          locationType={active}
          // ✅ never null now
          initialHours={initialByMode[active] ?? defaultHours()}
          onSaved={(hours) => {
            // ✅ defensive: if form returns garbage somehow, don’t destroy schedule
            const safe = looksLikeHours(hours) ? hours : defaultHours()

            setInitialByMode((prev) => ({ ...prev, [active]: safe }))
            onSavedAny?.()
          }}
        />
      </div>
    </div>
  )
}

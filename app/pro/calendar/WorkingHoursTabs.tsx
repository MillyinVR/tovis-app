// app/pro/calendar/WorkingHoursTabs.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import WorkingHoursForm, { type ApiWorkingHours, type LocationType } from './WorkingHoursForm'

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
  const accent =
    tone === 'salon'
      ? 'border-brand/30 bg-brand/8'
      : 'border-emerald-500/25 bg-emerald-500/6'

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

async function safeJson(res: Response) {
  return res.json().catch(() => ({})) as Promise<any>
}

export default function WorkingHoursTabs({
  canSalon,
  canMobile,
  activeLocationType,
  onChangeLocationType,
  onSavedAny,
}: {
  canSalon: boolean
  canMobile: boolean
  activeLocationType?: LocationType
  onChangeLocationType?: (next: LocationType) => void
  onSavedAny?: () => void
}) {
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

  const [initialByMode, setInitialByMode] = useState<Record<LocationType, ApiWorkingHours>>({
    SALON: null,
    MOBILE: null,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const next = availableTabs.includes(active) ? active : availableTabs[0]
    if (next !== active) setActive(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableTabs.join('|')])

  useEffect(() => {
    let cancelled = false

    async function loadAll() {
      try {
        setError(null)
        setLoading(true)

        const results = await Promise.all(
          availableTabs.map(async (m) => {
            const res = await fetch(`/api/pro/working-hours?locationType=${encodeURIComponent(m)}`, {
              method: 'GET',
              cache: 'no-store',
            })
            const data = await safeJson(res)
            if (!res.ok) throw new Error(data?.error || `Failed to load ${m} hours.`)
            return [m, (data?.workingHours ?? null) as ApiWorkingHours] as const
          }),
        )

        if (cancelled) return

        setInitialByMode((prev) => {
          const next = { ...prev }
          for (const [m, hours] of results) next[m] = hours
          return next
        })
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
  }, [availableTabs])

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
            <span className="font-extrabold text-textPrimary">
              {active === 'SALON' ? 'Salon' : 'Mobile'}
            </span>
          </div>
        </div>
      )}

      {loading ? <div className="text-[12px] text-textSecondary">Loading schedule…</div> : null}
      {error ? <div className="text-[12px] font-extrabold text-toneDanger">{error}</div> : null}

      <div className="tovis-glass-soft tovis-noise p-4">
        <WorkingHoursForm
          locationType={active}
          initialHours={initialByMode[active]}
          onSaved={(hours) => {
            setInitialByMode((prev) => ({ ...prev, [active]: hours }))
            onSavedAny?.()
          }}
        />
      </div>
    </div>
  )
}

// app/pro/calendar/WorkingHoursTabs.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import WorkingHoursForm, { type ApiWorkingHours, type LocationType } from './WorkingHoursForm'

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'rounded-full px-3 py-1 text-[12px] font-black transition',
        active
          ? 'bg-accentPrimary text-bgPrimary'
          : 'border border-white/10 text-textPrimary hover:border-white/20',
      ].join(' ')}
    >
      {children}
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
    // Always have at least one tab so the form can load.
    if (!tabs.length) tabs.push('SALON')
    return tabs
  }, [canSalon, canMobile])

  // controlled/uncontrolled support
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

  // keep local active valid if availableTabs changes
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

        const modes = availableTabs
        const results = await Promise.all(
          modes.map(async (m) => {
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
        <div className="flex items-center gap-2">
          {availableTabs.includes('SALON') && (
            <TabButton active={active === 'SALON'} onClick={() => setActive('SALON')}>
              Salon hours
            </TabButton>
          )}
          {availableTabs.includes('MOBILE') && (
            <TabButton active={active === 'MOBILE'} onClick={() => setActive('MOBILE')}>
              Mobile hours
            </TabButton>
          )}
        </div>
      )}

      {loading ? <div className="text-[12px] text-textSecondary">Loading schedule…</div> : null}
      {error ? <div className="text-[11px] font-semibold text-toneDanger">{error}</div> : null}

      <WorkingHoursForm
        locationType={active}
        initialHours={initialByMode[active]}
        onSaved={(hours) => {
          setInitialByMode((prev) => ({ ...prev, [active]: hours }))
          onSavedAny?.()
        }}
      />
    </div>
  )
}

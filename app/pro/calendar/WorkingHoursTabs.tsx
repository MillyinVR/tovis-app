// app/pro/calendar/WorkingHoursTabs.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import WorkingHoursForm, {
  type ApiWorkingHours,
  type LocationType,
} from './WorkingHoursForm'

import {
  errorMessageFromUnknown,
  readErrorMessage,
  safeJson,
} from '@/lib/http'

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkingHoursTabsProps = {
  canSalon: boolean
  canMobile: boolean
  activeEditorType?: LocationType
  onChangeEditorType?: (next: LocationType) => void
  onSavedAny?: () => void
}

type LocationTab = {
  value: LocationType
  label: string
  description: string
  tone: 'salon' | 'mobile'
}

type TabButtonProps = {
  tab: LocationTab
  active: boolean
  onClick: () => void
}

type StateCardProps = {
  children: ReactNode
  danger?: boolean
}

type WeekdayKey = keyof ApiWorkingHours

// ─── Constants ────────────────────────────────────────────────────────────────

const LOCATION_TABS: ReadonlyArray<LocationTab> = [
  {
    value: 'SALON',
    label: 'Salon hours',
    description: 'Appointments at your salon, suite, or fixed location.',
    tone: 'salon',
  },
  {
    value: 'MOBILE',
    label: 'Mobile hours',
    description: 'Appointments where you travel to the client.',
    tone: 'mobile',
  },
]

const WEEKDAY_KEYS: ReadonlyArray<WeekdayKey> = [
  'mon',
  'tue',
  'wed',
  'thu',
  'fri',
  'sat',
  'sun',
]

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function makeHoursDay(enabled: boolean) {
  return {
    enabled,
    start: '09:00',
    end: '17:00',
  }
}

/**
 * Safe non-null schedule default.
 * Never feed null/garbage into WorkingHoursForm.
 */
function defaultHours(): ApiWorkingHours {
  return {
    mon: makeHoursDay(true),
    tue: makeHoursDay(true),
    wed: makeHoursDay(true),
    thu: makeHoursDay(true),
    fri: makeHoursDay(true),
    sat: makeHoursDay(false),
    sun: makeHoursDay(false),
  }
}

function looksLikeHours(value: unknown): value is ApiWorkingHours {
  if (!isObject(value)) return false

  for (const day of WEEKDAY_KEYS) {
    const row = value[day]

    if (!isObject(row)) return false
    if (typeof row.enabled !== 'boolean') return false
    if (typeof row.start !== 'string') return false
    if (typeof row.end !== 'string') return false
  }

  return true
}

function availableTabsForCapabilities(args: {
  canSalon: boolean
  canMobile: boolean
}) {
  const tabs = LOCATION_TABS.filter((tab) => {
    if (tab.value === 'SALON') return args.canSalon
    if (tab.value === 'MOBILE') return args.canMobile

    return false
  })

  return tabs.length > 0 ? tabs : [LOCATION_TABS[0]]
}

function tabForLocationType(locationType: LocationType) {
  return LOCATION_TABS.find((tab) => tab.value === locationType) ?? LOCATION_TABS[0]
}

function firstAvailableType(tabs: ReadonlyArray<LocationTab>) {
  return tabs[0].value
}

function isAvailableLocationType(
  locationType: LocationType,
  tabs: ReadonlyArray<LocationTab>,
) {
  return tabs.some((tab) => tab.value === locationType)
}

function endpointForLocationType(locationType: LocationType) {
  const params = new URLSearchParams({ locationType })

  return `/api/pro/working-hours?${params.toString()}`
}

function errorFromResponse(
  response: Response,
  data: unknown,
  locationType: LocationType,
) {
  return (
    readErrorMessage(data) ??
    `Failed to load ${locationType.toLowerCase()} hours. (${response.status})`
  )
}

async function loadWorkingHours(args: {
  locationType: LocationType
  signal: AbortSignal
}): Promise<ApiWorkingHours> {
  const response = await fetch(endpointForLocationType(args.locationType), {
    method: 'GET',
    cache: 'no-store',
    signal: args.signal,
  })

  const data: unknown = await safeJson(response)

  if (!response.ok) {
    throw new Error(errorFromResponse(response, data, args.locationType))
  }

  const rawWorkingHours = isObject(data) ? data.workingHours : null

  return looksLikeHours(rawWorkingHours) ? rawWorkingHours : defaultHours()
}

function tabToneClassName(tone: LocationTab['tone'], active: boolean) {
  if (!active) {
    return [
      'border-[var(--line)] bg-transparent text-paperMute',
      'hover:bg-paper/5 hover:text-paper',
    ].join(' ')
  }

  if (tone === 'mobile') {
    return 'border-acid/35 bg-acid/10 text-paper'
  }

  return 'border-terra/45 bg-terra/10 text-paper'
}

function formShellClassName() {
  return [
    'rounded-2xl border border-[var(--line)] bg-paper/[0.03] p-4',
    'shadow-[0_16px_40px_rgb(0_0_0_/_0.20)]',
  ].join(' ')
}

// ─── Exported component ───────────────────────────────────────────────────────

export default function WorkingHoursTabs(props: WorkingHoursTabsProps) {
  const {
    canSalon,
    canMobile,
    activeEditorType,
    onChangeEditorType,
    onSavedAny,
  } = props

  const availableTabs = useMemo(
    () =>
      availableTabsForCapabilities({
        canSalon,
        canMobile,
      }),
    [canSalon, canMobile],
  )

  const [localActive, setLocalActive] = useState<LocationType>(
    firstAvailableType(availableTabs),
  )

  const active = activeEditorType ?? localActive

  const safeActive = isAvailableLocationType(active, availableTabs)
    ? active
    : firstAvailableType(availableTabs)

  const activeTab = tabForLocationType(safeActive)
  const showTabs = availableTabs.length > 1

  const [initialByMode, setInitialByMode] = useState<
    Record<LocationType, ApiWorkingHours>
  >({
    SALON: defaultHours(),
    MOBILE: defaultHours(),
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setActive(next: LocationType) {
    if (onChangeEditorType) {
      onChangeEditorType(next)
      return
    }

    setLocalActive(next)
  }

  useEffect(() => {
    if (active === safeActive) return

    if (onChangeEditorType) {
      onChangeEditorType(safeActive)
      return
    }

    setLocalActive(safeActive)
  }, [active, safeActive, onChangeEditorType])

  useEffect(() => {
    const controller = new AbortController()

    async function loadAll() {
      setError(null)
      setLoading(true)

      try {
        const shouldLoadSalon = availableTabs.some(
          (tab) => tab.value === 'SALON',
        )

        const shouldLoadMobile = availableTabs.some(
          (tab) => tab.value === 'MOBILE',
        )

        const [salon, mobile] = await Promise.all([
          shouldLoadSalon
            ? loadWorkingHours({
                locationType: 'SALON',
                signal: controller.signal,
              })
            : Promise.resolve(defaultHours()),
          shouldLoadMobile
            ? loadWorkingHours({
                locationType: 'MOBILE',
                signal: controller.signal,
              })
            : Promise.resolve(defaultHours()),
        ])

        if (controller.signal.aborted) return

        setInitialByMode({
          SALON: salon,
          MOBILE: mobile,
        })
      } catch (caught) {
        if (controller.signal.aborted) return

        setError(errorMessageFromUnknown(caught, 'Failed to load hours.'))
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void loadAll()

    return () => controller.abort()
  }, [availableTabs])

  return (
    <section
      className="grid gap-4"
      data-calendar-working-hours-tabs="1"
    >
      <div className="rounded-2xl border border-[var(--line)] bg-paper/[0.03] p-4">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-terraGlow">
              ◆ Availability editor
            </p>

            <h2 className="mt-1 font-display text-3xl font-semibold italic tracking-[-0.05em] text-paper">
              {activeTab.label}
            </h2>

            <p className="mt-2 max-w-2xl text-sm leading-6 text-paperDim">
              {activeTab.description}
            </p>
          </div>

          {showTabs ? (
            <div
              className="flex gap-2 overflow-x-auto pb-1 looksNoScrollbar"
              role="tablist"
              aria-label="Working hours type"
            >
              {availableTabs.map((tab) => (
                <TabButton
                  key={tab.value}
                  tab={tab}
                  active={safeActive === tab.value}
                  onClick={() => setActive(tab.value)}
                />
              ))}
            </div>
          ) : (
            <span className="rounded-full border border-[var(--line)] bg-paper/[0.04] px-3 py-2 font-mono text-[10px] font-black uppercase tracking-[0.08em] text-paperMute">
              {activeTab.value === 'SALON' ? 'Salon' : 'Mobile'}
            </span>
          )}
        </div>

        <div className="mt-4 grid gap-2">
          {loading ? <StateCard>Loading schedule…</StateCard> : null}
          {error ? <StateCard danger>{error}</StateCard> : null}
        </div>
      </div>

      <div className={formShellClassName()}>
        <WorkingHoursForm
          locationType={safeActive}
          initialHours={initialByMode[safeActive] ?? defaultHours()}
          onSaved={(hours) => {
            const safeHours = looksLikeHours(hours) ? hours : defaultHours()

            setInitialByMode((previous) => ({
              ...previous,
              [safeActive]: safeHours,
            }))

            onSavedAny?.()
          }}
        />
      </div>
    </section>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TabButton(props: TabButtonProps) {
  const { tab, active, onClick } = props

  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={[
        'shrink-0 rounded-full border px-3 py-2',
        'font-mono text-[10px] font-black uppercase tracking-[0.08em]',
        'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
        tabToneClassName(tab.tone, active),
      ].join(' ')}
    >
      {tab.value === 'SALON' ? 'Salon' : 'Mobile'}
    </button>
  )
}

function StateCard(props: StateCardProps) {
  const { children, danger = false } = props

  return (
    <div
      className={[
        'rounded-2xl border px-3 py-3 text-sm font-semibold',
        danger
          ? 'border-toneDanger/30 bg-toneDanger/10 text-toneDanger'
          : 'border-[var(--line)] bg-paper/[0.03] text-paperDim',
      ].join(' ')}
    >
      {children}
    </div>
  )
}
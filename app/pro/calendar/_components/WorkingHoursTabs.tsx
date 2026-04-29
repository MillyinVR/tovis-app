// app/pro/calendar/_components/WorkingHoursTabs.tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

import WorkingHoursForm, {
  type ApiWorkingHours,
  type LocationType,
} from './WorkingHoursForm'

import type { BrandWorkingHoursCopy } from '@/lib/brand/types'

import {
  errorMessageFromUnknown,
  readErrorMessage,
  safeJson,
} from '@/lib/http'
import { isRecord } from '@/lib/guards'

// ─── Types ────────────────────────────────────────────────────────────────────

type WorkingHoursTabsProps = {
  copy: BrandWorkingHoursCopy
  canSalon: boolean
  canMobile: boolean
  activeEditorType?: LocationType
  onChangeEditorType?: (next: LocationType) => void
  onSavedAny?: () => void
}

type LocationTab = {
  value: LocationType
  label: string
  shortLabel: string
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

function locationTabs(
  copy: BrandWorkingHoursCopy,
): readonly [LocationTab, LocationTab] {
  return [
    {
      value: 'SALON',
      label: copy.locations.salon.label,
      shortLabel: copy.locations.salon.shortLabel,
      description: copy.locations.salon.description,
      tone: 'salon',
    },
    {
      value: 'MOBILE',
      label: copy.locations.mobile.label,
      shortLabel: copy.locations.mobile.shortLabel,
      description: copy.locations.mobile.description,
      tone: 'mobile',
    },
  ]
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
  if (!isRecord(value)) return false

  for (const day of WEEKDAY_KEYS) {
    const row = value[day]

    if (!isRecord(row)) return false
    if (typeof row.enabled !== 'boolean') return false
    if (typeof row.start !== 'string') return false
    if (typeof row.end !== 'string') return false
  }

  return true
}

function isLocationTab(value: LocationTab | undefined): value is LocationTab {
  return value !== undefined
}

function firstLocationTab(tabs: ReadonlyArray<LocationTab>): LocationTab {
  const first = tabs[0]

  if (!first) {
    throw new Error('Working hours tabs require at least one location tab.')
  }

  return first
}

function availableTabsForCapabilities(args: {
  tabs: readonly [LocationTab, LocationTab]
  canSalon: boolean
  canMobile: boolean
}): ReadonlyArray<LocationTab> {
  const tabs = args.tabs.filter((tab) => {
    if (tab.value === 'SALON') return args.canSalon
    if (tab.value === 'MOBILE') return args.canMobile

    return false
  })

  return tabs.length > 0 ? tabs : [args.tabs[0]].filter(isLocationTab)
}

function tabForLocationType(args: {
  locationType: LocationType
  tabs: ReadonlyArray<LocationTab>
}): LocationTab {
  return (
    args.tabs.find((tab) => tab.value === args.locationType) ??
    firstLocationTab(args.tabs)
  )
}

function firstAvailableType(tabs: ReadonlyArray<LocationTab>): LocationType {
  return firstLocationTab(tabs).value
}

function isAvailableLocationType(
  locationType: LocationType,
  tabs: ReadonlyArray<LocationTab>,
): boolean {
  return tabs.some((tab) => tab.value === locationType)
}

function endpointForLocationType(locationType: LocationType): string {
  const params = new URLSearchParams({ locationType })

  return `/api/pro/working-hours?${params.toString()}`
}

function errorFromResponse(args: {
  response: Response
  data: unknown
  locationType: LocationType
}): string {
  return (
    readErrorMessage(args.data) ??
    `Failed to load ${args.locationType.toLowerCase()} hours. (${
      args.response.status
    })`
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
    throw new Error(
      errorFromResponse({
        response,
        data,
        locationType: args.locationType,
      }),
    )
  }

  const rawWorkingHours = isRecord(data) ? data.workingHours : null

  return looksLikeHours(rawWorkingHours) ? rawWorkingHours : defaultHours()
}

// ─── Exported component ───────────────────────────────────────────────────────

export default function WorkingHoursTabs(props: WorkingHoursTabsProps) {
  const {
    copy,
    canSalon,
    canMobile,
    activeEditorType,
    onChangeEditorType,
    onSavedAny,
  } = props

  const tabs = useMemo(() => locationTabs(copy), [copy])

  const availableTabs = useMemo(
    () =>
      availableTabsForCapabilities({
        tabs,
        canSalon,
        canMobile,
      }),
    [canSalon, canMobile, tabs],
  )

  const [localActive, setLocalActive] = useState<LocationType>(
    firstAvailableType(availableTabs),
  )

  const active = activeEditorType ?? localActive

  const safeActive = isAvailableLocationType(active, availableTabs)
    ? active
    : firstAvailableType(availableTabs)

  const activeTab = tabForLocationType({
    locationType: safeActive,
    tabs: availableTabs,
  })

  const showTabs = availableTabs.length > 1

  const [initialByMode, setInitialByMode] = useState<
    Record<LocationType, ApiWorkingHours>
  >({
    SALON: defaultHours(),
    MOBILE: defaultHours(),
  })

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function setActive(next: LocationType): void {
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

    async function loadAll(): Promise<void> {
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

        setError(
          errorMessageFromUnknown(
            caught,
            copy.status.failedLoadHours,
          ),
        )
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    void loadAll()

    return () => controller.abort()
  }, [availableTabs, copy.status.failedLoadHours])

  return (
    <section
      className="brand-pro-calendar-working-tabs"
      data-calendar-working-hours-tabs="true"
    >
      <div className="brand-pro-calendar-working-tabs-header">
        <div className="brand-pro-calendar-working-tabs-header-row">
          <div className="brand-pro-calendar-working-tabs-copy">
            <p className="brand-pro-calendar-working-tabs-eyebrow">
              {copy.overlay.eyebrow}
            </p>

            <h2 className="brand-pro-calendar-working-tabs-title">
              {activeTab.label}
            </h2>

            <p className="brand-pro-calendar-working-tabs-description">
              {activeTab.description}
            </p>
          </div>

          {showTabs ? (
            <div
              className="brand-pro-calendar-working-tabs-list looksNoScrollbar"
              role="tablist"
              aria-label={copy.locationTabsAriaLabel}
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
            <span
              className="brand-pro-calendar-working-tabs-single"
              data-tone={activeTab.tone}
            >
              {activeTab.shortLabel}
            </span>
          )}
        </div>

        <div className="brand-pro-calendar-working-tabs-state-list">
          {loading ? (
            <StateCard>{copy.status.loadingSchedule}</StateCard>
          ) : null}

          {error ? <StateCard danger>{error}</StateCard> : null}
        </div>
      </div>

      <div className="brand-pro-calendar-working-tabs-form-shell">
        <WorkingHoursForm
          copy={copy}
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
      className="brand-pro-calendar-working-tabs-button brand-focus"
      data-active={active ? 'true' : 'false'}
      data-tone={tab.tone}
    >
      {tab.shortLabel}
    </button>
  )
}

function StateCard(props: StateCardProps) {
  const { children, danger = false } = props

  return (
    <div
      className="brand-pro-calendar-working-tabs-state"
      data-danger={danger ? 'true' : 'false'}
    >
      {children}
    </div>
  )
}
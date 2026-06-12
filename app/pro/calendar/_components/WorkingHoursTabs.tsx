// app/pro/calendar/_components/WorkingHoursTabs.tsx
'use client'

import { useMemo, useState } from 'react'

import WorkingHoursForm, { type LocationType } from './WorkingHoursForm'

import type { BrandWorkingHoursCopy } from '@/lib/brand/types'

// ─── Types ────────────────────────────────────────────────────────────────────

export type WorkingHoursLocationOption = {
  id: string
  type: string
  name: string | null
  formattedAddress: string | null
  isPrimary: boolean
}

type WorkingHoursTabsProps = {
  copy: BrandWorkingHoursCopy
  canSalon: boolean
  canMobile: boolean
  locations?: ReadonlyArray<WorkingHoursLocationOption>
  defaultLocationId?: string | null
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

function modeForLocationType(type: string): LocationType {
  return type.trim().toUpperCase() === 'MOBILE_BASE' ? 'MOBILE' : 'SALON'
}

const LOCATION_TYPE_LABELS: Record<string, string> = {
  MOBILE_BASE: 'Mobile base',
  SUITE: 'Suite',
  SALON: 'Salon',
}

function locationOptionLabel(location: WorkingHoursLocationOption): string {
  const name = (location.name ?? '').trim()
  const address = (location.formattedAddress ?? '').trim()
  const base =
    name || LOCATION_TYPE_LABELS[location.type.trim().toUpperCase()] || 'Location'
  const withAddress = address ? `${base} — ${address}` : base

  return location.isPrimary ? `${withAddress} (Primary)` : withAddress
}

function locationsForMode(
  locations: ReadonlyArray<WorkingHoursLocationOption>,
  mode: LocationType,
): WorkingHoursLocationOption[] {
  return locations
    .filter((location) => modeForLocationType(location.type) === mode)
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary))
}

function resolveSelectedLocationId(args: {
  modeLocations: ReadonlyArray<WorkingHoursLocationOption>
  selectedId: string | null
  defaultLocationId: string | null
}): string | null {
  const { modeLocations, selectedId, defaultLocationId } = args

  if (modeLocations.length === 0) return null

  if (selectedId && modeLocations.some((l) => l.id === selectedId)) {
    return selectedId
  }

  if (
    defaultLocationId &&
    modeLocations.some((l) => l.id === defaultLocationId)
  ) {
    return defaultLocationId
  }

  return modeLocations[0]?.id ?? null
}

// ─── Exported component ───────────────────────────────────────────────────────

export default function WorkingHoursTabs(props: WorkingHoursTabsProps) {
  const {
    copy,
    canSalon,
    canMobile,
    locations = [],
    defaultLocationId = null,
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

  // Per-mode location selection so each salon/suite/mobile base can keep
  // its own hours. Falls back to mode-wide editing when no locations are
  // supplied (legacy behavior).
  const [selectedByMode, setSelectedByMode] = useState<
    Record<LocationType, string | null>
  >({
    SALON: null,
    MOBILE: null,
  })

  const modeLocations = useMemo(
    () => locationsForMode(locations, safeActive),
    [locations, safeActive],
  )

  const selectedLocationId = resolveSelectedLocationId({
    modeLocations,
    selectedId: selectedByMode[safeActive],
    defaultLocationId,
  })

  const showLocationPicker = modeLocations.length > 1

  function setActive(next: LocationType): void {
    if (onChangeEditorType) {
      onChangeEditorType(next)
      return
    }

    setLocalActive(next)
  }

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

        {showLocationPicker ? (
          <label className="brand-pro-calendar-working-tabs-location-picker">
            <span className="brand-pro-calendar-working-tabs-location-picker-label">
              Location
            </span>

            <select
              value={selectedLocationId ?? ''}
              onChange={(event) =>
                setSelectedByMode((previous) => ({
                  ...previous,
                  [safeActive]: event.target.value || null,
                }))
              }
              className="brand-pro-calendar-working-tabs-location-picker-select brand-focus"
              aria-label="Choose which location these hours apply to"
            >
              {modeLocations.map((location) => (
                <option key={location.id} value={location.id}>
                  {locationOptionLabel(location)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="brand-pro-calendar-working-tabs-form-shell">
        <WorkingHoursForm
          key={`${safeActive}:${selectedLocationId ?? 'mode'}`}
          copy={copy}
          locationType={safeActive}
          locationId={selectedLocationId}
          onSaved={() => {
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

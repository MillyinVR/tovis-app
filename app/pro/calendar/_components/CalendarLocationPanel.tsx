// app/pro/calendar/_components/CalendarLocationPanel.tsx
'use client'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CalendarLocation = {
  id: string
  type?: string | null
  name?: string | null
  formattedAddress?: string | null
}

export type CalendarLocationPanelCopy = {
  eyebrow: string
  titleFallback: string
  description: string
  selectLabel: string
  selectAriaLabel: string
  selectFallback: string
  timeZoneLabel: string
  emptyState: string
}

type CalendarLocationPanelProps = {
  copy: CalendarLocationPanelCopy
  locationsLoaded: boolean
  scopedLocations: CalendarLocation[]
  activeLocationId: string | null
  activeLocationLabel: string | null
  calendarTimeZone: string
  onChangeLocation: (locationId: string | null) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LOCATION_TYPE_LABELS: Record<string, string> = {
  MOBILE_BASE: 'Mobile base',
  SUITE: 'Suite',
  SALON: 'Salon',
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function normalizeText(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function locationTypeLabel(
  type: string | null | undefined,
  fallbackLabel: string,
): string {
  const normalizedType = normalizeText(type).toUpperCase()

  return LOCATION_TYPE_LABELS[normalizedType] ?? fallbackLabel
}

function labelForLocation(args: {
  location: CalendarLocation
  fallbackLabel: string
}): string {
  const { location, fallbackLabel } = args

  const name = normalizeText(location.name)
  const address = normalizeText(location.formattedAddress)
  const baseLabel = name || locationTypeLabel(location.type, fallbackLabel)

  return address ? `${baseLabel} — ${address}` : baseLabel
}

function selectedLocationLabel(args: {
  activeLocationLabel: string | null
  activeLocationId: string | null
  locations: CalendarLocation[]
  fallbackLabel: string
}): string | null {
  const {
    activeLocationLabel,
    activeLocationId,
    locations,
    fallbackLabel,
  } = args

  const explicitLabel = normalizeText(activeLocationLabel)

  if (explicitLabel) return explicitLabel

  const selectedLocation = locations.find(
    (location) => location.id === activeLocationId,
  )

  if (!selectedLocation) return null

  return labelForLocation({
    location: selectedLocation,
    fallbackLabel,
  })
}

function hasSelectedLocation(args: {
  activeLocationId: string | null
  locations: CalendarLocation[]
}): boolean {
  const selectedId = normalizeText(args.activeLocationId)

  if (!selectedId) return false

  return args.locations.some((location) => location.id === selectedId)
}

// ─── Exported component ───────────────────────────────────────────────────────

export function CalendarLocationPanel(props: CalendarLocationPanelProps) {
  const {
    copy,
    locationsLoaded,
    scopedLocations,
    activeLocationId,
    activeLocationLabel,
    calendarTimeZone,
    onChangeLocation,
  } = props

  if (!locationsLoaded) return null

  const hasLocations = scopedLocations.length > 0

  const selectedLabel = selectedLocationLabel({
    activeLocationLabel,
    activeLocationId,
    locations: scopedLocations,
    fallbackLabel: copy.selectFallback,
  })

  const selectedIsValid = hasSelectedLocation({
    activeLocationId,
    locations: scopedLocations,
  })

  return (
    <section
      className="brand-pro-calendar-location-panel"
      data-calendar-location-panel="true"
      data-has-locations={hasLocations ? 'true' : 'false'}
    >
      <div className="brand-pro-calendar-location-panel-inner">
        <div className="brand-pro-calendar-location-panel-copy">
          <p className="brand-pro-calendar-location-panel-eyebrow">
            {copy.eyebrow}
          </p>

          <h2 className="brand-pro-calendar-location-panel-title">
            {selectedLabel || copy.titleFallback}
          </h2>

          <p className="brand-pro-calendar-location-panel-description">
            {copy.description}
          </p>
        </div>

        {hasLocations ? (
          <div className="brand-pro-calendar-location-panel-control">
            <label className="brand-pro-calendar-location-panel-select-wrap">
              <span className="brand-pro-calendar-location-panel-select-label">
                {copy.selectLabel}
              </span>

              <select
                value={selectedIsValid ? activeLocationId ?? '' : ''}
                onChange={(event) =>
                  onChangeLocation(event.target.value || null)
                }
                className="brand-pro-calendar-location-panel-select brand-focus"
                aria-label={copy.selectAriaLabel}
              >
                {selectedIsValid ? null : (
                  <option value="">{copy.titleFallback}</option>
                )}

                {scopedLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {labelForLocation({
                      location,
                      fallbackLabel: copy.selectFallback,
                    })}
                  </option>
                ))}
              </select>
            </label>

            <p className="brand-pro-calendar-location-panel-timezone">
              {copy.timeZoneLabel}:{' '}
              <span className="brand-pro-calendar-location-panel-timezone-value">
                {calendarTimeZone}
              </span>
            </p>
          </div>
        ) : (
          <div className="brand-pro-calendar-location-panel-empty">
            {copy.emptyState}
          </div>
        )}
      </div>
    </section>
  )
}
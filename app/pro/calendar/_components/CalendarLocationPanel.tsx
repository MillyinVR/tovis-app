// app/pro/calendar/_components/CalendarLocationPanel.tsx
'use client'

// ─── Types ────────────────────────────────────────────────────────────────────

type CalendarLocation = {
  id: string
  type?: string | null
  name?: string | null
  formattedAddress?: string | null
}

type CalendarLocationPanelProps = {
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

function locationTypeLabel(type: string | null | undefined): string {
  const normalizedType = normalizeText(type).toUpperCase()

  return LOCATION_TYPE_LABELS[normalizedType] ?? 'Location'
}

function labelForLocation(location: CalendarLocation): string {
  const name = normalizeText(location.name)
  const address = normalizeText(location.formattedAddress)
  const baseLabel = name || locationTypeLabel(location.type)

  return address ? `${baseLabel} — ${address}` : baseLabel
}

function selectedLocationLabel(args: {
  activeLocationLabel: string | null
  activeLocationId: string | null
  locations: CalendarLocation[]
}): string | null {
  const explicitLabel = normalizeText(args.activeLocationLabel)

  if (explicitLabel) return explicitLabel

  const selectedLocation = args.locations.find(
    (location) => location.id === args.activeLocationId,
  )

  return selectedLocation ? labelForLocation(selectedLocation) : null
}

function panelClassName(): string {
  return [
    'rounded-2xl border border-[var(--line)]',
    'bg-[rgb(var(--surface-glass)_/_0.03)] p-4',
  ].join(' ')
}

function eyebrowClassName(): string {
  return [
    'font-mono text-[10px] font-black uppercase tracking-[0.16em]',
    'text-[rgb(var(--accent-primary-hover))]',
  ].join(' ')
}

function titleClassName(): string {
  return [
    'mt-1 font-display text-2xl font-semibold italic tracking-[-0.04em]',
    'text-[rgb(var(--text-primary))]',
  ].join(' ')
}

function bodyTextClassName(): string {
  return 'mt-2 text-sm leading-6 text-[rgb(var(--text-secondary))]'
}

function selectClassName(): string {
  return [
    'w-full rounded-xl border border-[var(--line)]',
    'bg-[rgb(var(--bg-secondary))] px-3 py-2',
    'font-mono text-[11px] font-black uppercase tracking-[0.06em]',
    'text-[rgb(var(--text-primary))] outline-none',
    'focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
    'md:w-auto md:min-w-[16rem]',
  ].join(' ')
}

function selectLabelClassName(): string {
  return [
    'font-mono text-[9px] font-black uppercase tracking-[0.12em]',
    'text-[rgb(var(--text-muted))]',
  ].join(' ')
}

function timeZoneClassName(): string {
  return [
    'font-mono text-[9px] font-black uppercase tracking-[0.10em]',
    'text-[rgb(var(--text-muted))]',
  ].join(' ')
}

function emptyStateClassName(): string {
  return [
    'rounded-2xl border border-toneWarn/25 bg-toneWarn/10 px-3 py-3',
    'text-sm font-semibold text-toneWarn',
  ].join(' ')
}

// ─── Exported component ───────────────────────────────────────────────────────

export function CalendarLocationPanel(props: CalendarLocationPanelProps) {
  const {
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
  })

  return (
    <section
      className={panelClassName()}
      data-calendar-location-panel="1"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className={eyebrowClassName()}>◆ Calendar location</p>

          <h2 className={titleClassName()}>
            {selectedLabel || 'Select location.'}
          </h2>

          <p className={bodyTextClassName()}>
            Booking creation and blocked-time actions use this selected
            location.
          </p>
        </div>

        {hasLocations ? (
          <div className="grid gap-2 md:justify-items-end">
            <label className="grid gap-1">
              <span className={selectLabelClassName()}>Location</span>

              <select
                value={activeLocationId ?? ''}
                onChange={(event) =>
                  onChangeLocation(event.target.value || null)
                }
                className={selectClassName()}
                aria-label="Select calendar location"
              >
                {activeLocationId ? null : (
                  <option value="">Select location</option>
                )}

                {scopedLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {labelForLocation(location)}
                  </option>
                ))}
              </select>
            </label>

            <p className={timeZoneClassName()}>
              TZ:{' '}
              <span className="text-[rgb(var(--text-primary))]">
                {calendarTimeZone}
              </span>
            </p>
          </div>
        ) : (
          <div className={emptyStateClassName()}>
            No bookable locations yet. Add a location to use the calendar.
          </div>
        )}
      </div>
    </section>
  )
}
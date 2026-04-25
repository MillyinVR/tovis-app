// app/pro/calendar/_components/CalendarLocationPanel.tsx
'use client'

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

const LOCATION_TYPE_LABELS: Record<string, string> = {
  MOBILE_BASE: 'Mobile base',
  SUITE: 'Suite',
  SALON: 'Salon',
}

function normalizeText(value: string | null | undefined) {
  return typeof value === 'string' ? value.trim() : ''
}

function locationTypeLabel(type: string | null | undefined) {
  const normalizedType = normalizeText(type).toUpperCase()
  return LOCATION_TYPE_LABELS[normalizedType] ?? 'Location'
}

function labelForLocation(location: CalendarLocation) {
  const name = normalizeText(location.name)
  const address = normalizeText(location.formattedAddress)
  const baseLabel = name || locationTypeLabel(location.type)

  return address ? `${baseLabel} — ${address}` : baseLabel
}

function selectedLocationLabel(args: {
  activeLocationLabel: string | null
  activeLocationId: string | null
  locations: CalendarLocation[]
}) {
  const explicitLabel = normalizeText(args.activeLocationLabel)
  if (explicitLabel) return explicitLabel

  const selectedLocation = args.locations.find(
    (location) => location.id === args.activeLocationId,
  )

  return selectedLocation ? labelForLocation(selectedLocation) : null
}

function selectClassName() {
  return [
    'w-full rounded-xl border border-[var(--line)] bg-[var(--ink-2)] px-3 py-2',
    'font-mono text-[11px] font-black uppercase tracking-[0.06em]',
    'text-[var(--paper)] outline-none',
    'focus-visible:ring-2 focus-visible:ring-accentPrimary/40',
    'disabled:cursor-not-allowed disabled:opacity-60',
    'md:w-auto md:min-w-[16rem]',
  ].join(' ')
}

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
      className="rounded-2xl border border-[var(--line)] bg-[var(--paper)]/[0.03] p-4"
      data-calendar-location-panel="1"
    >
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-[var(--terra-glow)]">
            ◆ Calendar location
          </p>

          <h2 className="mt-1 font-display text-2xl font-semibold italic tracking-[-0.04em] text-[var(--paper)]">
            {selectedLabel || 'Select location.'}
          </h2>

          <p className="mt-2 text-sm leading-6 text-[var(--paper-dim)]">
            Booking creation and blocked-time actions use this selected location.
          </p>
        </div>

        {hasLocations ? (
          <div className="grid gap-2 md:justify-items-end">
            <label className="grid gap-1">
              <span className="font-mono text-[9px] font-black uppercase tracking-[0.12em] text-[var(--paper-mute)]">
                Location
              </span>

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

            <p className="font-mono text-[9px] font-black uppercase tracking-[0.10em] text-[var(--paper-mute)]">
              TZ:{' '}
              <span className="text-[var(--paper)]">
                {calendarTimeZone}
              </span>
            </p>
          </div>
        ) : (
          <div className="rounded-2xl border border-toneWarn/25 bg-toneWarn/10 px-3 py-3 text-sm font-semibold text-toneWarn">
            No bookable locations yet. Add a location to use the calendar.
          </div>
        )}
      </div>
    </section>
  )
}
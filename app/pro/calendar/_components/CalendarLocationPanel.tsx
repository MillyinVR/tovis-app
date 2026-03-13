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

function labelForLocation(location: CalendarLocation) {
  const type = String(location.type || '').toUpperCase()

  const base =
    (location.name && location.name.trim()) ||
    (type === 'MOBILE_BASE'
      ? 'Mobile base'
      : type === 'SUITE'
        ? 'Suite'
        : type === 'SALON'
          ? 'Salon'
          : 'Location')

  const address =
    location.formattedAddress && location.formattedAddress.trim()
      ? ` — ${location.formattedAddress.trim()}`
      : ''

  return `${base}${address}`
}

export function CalendarLocationPanel({
  locationsLoaded,
  scopedLocations,
  activeLocationId,
  activeLocationLabel,
  calendarTimeZone,
  onChangeLocation,
}: CalendarLocationPanelProps) {
  if (!locationsLoaded) return null

  const hasLocations = scopedLocations.length > 0

  return (
    <section className="mb-4">
      <div className="tovis-glass-soft tovis-noise rounded-2xl border border-white/10 px-4 py-4 md:px-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[12px] font-black text-textSecondary">
              Calendar location
            </div>
            <div className="mt-1 text-[12px] font-semibold text-textSecondary">
              All appointments for this pro are shown here. Blocked time and
              create-booking actions use the selected location.
            </div>
          </div>

          {hasLocations ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={activeLocationId ?? ''}
                onChange={(e) => onChangeLocation(e.target.value || null)}
                className="rounded-2xl border border-white/12 bg-bgPrimary/30 px-3 py-2 text-[13px] font-bold text-textPrimary outline-none"
                aria-label="Select calendar location"
              >
                {scopedLocations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {labelForLocation(location)}
                  </option>
                ))}
              </select>

              <div className="text-[12px] font-semibold text-textSecondary">
                TZ:{' '}
                <span className="font-black text-textPrimary">
                  {calendarTimeZone}
                </span>
              </div>
            </div>
          ) : (
            <div className="text-[12px] font-semibold text-toneWarn">
              No bookable locations yet. Add a location to use the calendar.
            </div>
          )}
        </div>

        {activeLocationLabel ? (
          <div className="mt-3 text-[12px] font-semibold text-textSecondary">
            Selected location:{' '}
            <span className="font-black text-textPrimary">
              {activeLocationLabel}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  )
}
// app/pro/calendar/_utils/locationLabels.ts
//
// How a professional location is NAMED on the calendar. Pure; no React.
//
// One home for the type→word map, which the location panel and the locations
// hook each used to keep a private copy of — two tables that had already
// drifted apart in their fallback word. The all-locations feed (K3) needs a
// third form (the short chip on an event card), and a third copy of the same
// map is exactly what the no-duplicate-logic rule exists to prevent.

// ─── Types ────────────────────────────────────────────────────────────────────

type LocationNameParts = {
  type?: string | null
  name?: string | null
  formattedAddress?: string | null
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

// ─── Exported helpers ─────────────────────────────────────────────────────────

/** "Salon" / "Suite" / "Mobile base" — `fallbackLabel` for anything unknown. */
export function locationTypeLabel(
  type: string | null | undefined,
  fallbackLabel: string,
): string {
  return LOCATION_TYPE_LABELS[normalizeText(type).toUpperCase()] ?? fallbackLabel
}

/** The panel/selector form: a name (or type) plus the street address. */
export function locationFullLabel(args: {
  location: LocationNameParts
  fallbackLabel: string
}): string {
  const { location, fallbackLabel } = args

  const address = normalizeText(location.formattedAddress)
  const base = locationShortLabel({ location, fallbackLabel })

  return address ? `${base} — ${address}` : base
}

/**
 * The compact form for a chip on an event card, where the address would not
 * fit: the pro's own name for the location, else what kind of place it is.
 */
export function locationShortLabel(args: {
  location: LocationNameParts
  fallbackLabel: string
}): string {
  const { location, fallbackLabel } = args

  return (
    normalizeText(location.name) || locationTypeLabel(location.type, fallbackLabel)
  )
}

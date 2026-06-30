// lib/booking/serviceLabel.ts
//
// Single source of truth for turning a booking's service line items into a
// human-readable label. A booking can carry multiple co-equal BASE services
// (e.g. "Haircut + Color") plus optional ADD_ONs, so anything that used to
// render `booking.service.name` (the single primary) should prefer this.

const ADD_ON = 'ADD_ON'

export type ServiceLabelItem = {
  name: string | null | undefined
  // Accepts the Prisma `BookingServiceItemType` enum or its string form.
  itemType: string | null | undefined
}

function cleanName(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed : null
}

function isAddOn(itemType: string | null | undefined): boolean {
  return String(itemType ?? '').toUpperCase() === ADD_ON
}

/**
 * Joins a booking's service names for display: every co-equal BASE service
 * first (in the order given), then any ADD_ONs, separated by " + ". Falls back
 * to `fallbackName` (typically the booking's single primary service name) and
 * finally to a generic label when no named items are available.
 *
 * Callers should pass items already ordered by `sortOrder`.
 */
export function formatBookingServicesLabel(
  items: ServiceLabelItem[],
  fallbackName?: string | null,
): string {
  const baseNames = items
    .filter((item) => !isAddOn(item.itemType))
    .map((item) => cleanName(item.name))
    .filter((name): name is string => name !== null)

  const addOnNames = items
    .filter((item) => isAddOn(item.itemType))
    .map((item) => cleanName(item.name))
    .filter((name): name is string => name !== null)

  const all = [...baseNames, ...addOnNames]
  if (all.length > 0) return all.join(' + ')

  return cleanName(fallbackName) ?? 'Appointment'
}

// app/client/_components/bookingDisplay.ts
//
// Shared display helpers for client-home booking cards. Single source of
// truth for the booking title line; previously duplicated per card.

import type { ClientHomeBooking } from '../_data/getClientHomeData'

export function bookingTitle(booking: ClientHomeBooking): string {
  const serviceItemNames = booking.serviceItems
    .map((item) => item.service?.name?.trim())
    .filter((name): name is string => Boolean(name))

  const firstServiceName = serviceItemNames[0]
  if (firstServiceName !== undefined && serviceItemNames.length === 1) {
    return firstServiceName
  }
  if (firstServiceName !== undefined && serviceItemNames.length > 1) {
    return `${firstServiceName} + ${serviceItemNames.length - 1} more`
  }

  return booking.service?.name ?? 'Appointment'
}

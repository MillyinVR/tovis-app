// lib/pro/offeringDisplayName.ts
//
// What to CALL one of a pro's service offerings on a pro-facing surface: the
// pro's own title when they gave it one, the catalog service name otherwise.
//
// One helper because the two answers must not drift — a pro who renamed
// "Manicure" to "Signature Mani" should read the same name in the last-minute
// workspace and in the live-hold decision popup, not one of each.

export function offeringDisplayName(offering: {
  title: string | null
  service: { name: string }
}): string {
  const title = offering.title?.trim()

  return title ? title : offering.service.name
}

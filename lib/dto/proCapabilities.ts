// lib/dto/proCapabilities.ts
//
// Wire contract for GET /api/v1/pro/capabilities — which flag-held pro features
// are actually live for this deployment.
//
// Why this exists: web reads the env flags server-side and simply omits the
// surface when one is off (the no-show section of `EditPaymentSettingsButton`
// takes a `noShowFeatureEnabled` prop; `ProHeader` drops the Import tab). A
// native client has no such view — before this endpoint the only way for iOS to
// learn a flag was to navigate to the feature and read a 404, which is why both
// rows dead-ended on a "Coming soon" screen. This is the same server-side answer
// web already gets, put on the wire.
//
// NOT flag-gated itself: it has to be answerable precisely when the features are
// off. It carries no data beyond the booleans.

/**
 * Deployment-level switches for pro features that are built but held.
 *
 * Each key is a capability the client may *offer*, not a per-pro entitlement:
 * `true` means the endpoints behind it answer instead of 404ing. A client that
 * cannot read this (offline, error) must treat every capability as `false` —
 * hiding a live feature is recoverable, offering a dead one is not.
 */
export type ProCapabilitiesDTO = {
  /**
   * `ENABLE_NO_SHOW_PROTECTION` — the pro's no-show / late-cancel fee policy
   * settings, the client card-on-file rail, and real fee charging.
   */
  noShowFees: boolean
  /**
   * `ENABLE_PRO_MIGRATION` — the guided import wizard (services, clients,
   * calendar) for a pro coming from another booking app.
   */
  importFromAnotherApp: boolean
  /**
   * `ENABLE_RECURRING_APPOINTMENTS` — standing appointments (BookingSeries):
   * the series create/edit surface and the write boundary that stamps
   * seriesId onto bookings. K18 ships with no UI; until the flag is on, no pro
   * can create a standing appointment and nothing acquires a seriesId.
   */
  recurringAppointments: boolean
}

/** Response for GET /api/v1/pro/capabilities. */
export type ProCapabilitiesResponseDTO = {
  capabilities: ProCapabilitiesDTO
}

// lib/booking/series/flag.ts
//
// Master switch for K18 recurring appointments (Phase 8).
//
// Prod leaves ENABLE_RECURRING_APPOINTMENTS unset → the series route refuses and
// the write boundary refuses, so no pro can create a standing appointment and no
// booking can acquire a seriesId. Nothing about today's booking flow changes.
//
// 🔴 The switch must reach the CONTROL, not only the writers
// ([[kill-switch-must-reach-the-control]]). K18 ships with no UI at all — K19
// builds the create/edit surface — so the only control that exists today is the
// POST route, which gates on this same helper. When K19 adds the calendar
// entry point it must gate on THIS function too: a button that opens a form the
// server will refuse is an offered option that cannot be accepted.
//
// Mirrors noShowProtectionEnabled() in lib/noShowProtection/flag.ts.

export function recurringAppointmentsEnabled(): boolean {
  const raw = process.env.ENABLE_RECURRING_APPOINTMENTS
  if (typeof raw !== 'string') return false
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

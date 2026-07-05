// app/pro/migrate/_exportInstructions.ts
//
// Per-source export guidance for the migration funnel. When a pro picks the app
// they're coming from on the entry page, we show them exactly how to get the
// three files this flow needs (service menu, client list, calendar) out of that
// app. Data-only + brand-neutral (every step is about the SOURCE app, never
// ours), so it lives beside _constants.ts rather than in lib/brand.
//
// Steps are kept intentionally version-agnostic — the goal is to point the pro at
// the right screen and format, not to assert exact menu paths that shift between
// app releases. The universal fallback (see MigrationCopy.entry.exportGuide) tells
// them a plain CSV works when an app has no direct export.

import type { SourceApp } from './_types'

export type MigrationExportGuide = {
  // How to get the service / price list as a CSV.
  menu: string
  // How to get the client / customer list as a CSV.
  clients: string
  // How to get upcoming appointments (an .ics file or a calendar-feed URL).
  calendar: string
  // True when the app can hand you a live calendar-feed URL (webcal/https) —
  // the calendar step then supports "keep synced" instead of a one-off upload.
  calendarFeed: boolean
}

const GENERIC: MigrationExportGuide = {
  menu: 'Open your service or price list and export/download it as a CSV. No export? A simple spreadsheet with a name and price column works too.',
  clients:
    'Open your client or customer list and export/download it as a CSV. Look under Settings, Reports, or the list’s ••• / Export menu.',
  calendar:
    'Turn on calendar sync to get an iCal (.ics) link, or export your appointments as an .ics file.',
  calendarFeed: false,
}

export const EXPORT_GUIDES: Record<SourceApp, MigrationExportGuide> = {
  Vagaro: {
    menu: 'In Vagaro, open your service menu (Business → Services) and export the list as a CSV.',
    clients: 'In Vagaro, go to Customers and choose Export to download your client list as a CSV.',
    calendar:
      'In Vagaro, turn on Calendar Sync to get an iCal feed link you can paste below, or export your appointments as .ics.',
    calendarFeed: true,
  },
  GlossGenius: {
    menu: 'GlossGenius has no service-list export — build a quick CSV with a service name and price column and upload that (we match each name to the catalog as you go).',
    clients: 'In GlossGenius, open Clients and use Export clients to download a CSV.',
    calendar:
      'In GlossGenius, connect your calendar (Google/Apple) to get an iCal link, or export upcoming appointments as .ics.',
    calendarFeed: false,
  },
  Booksy: {
    menu: 'In Booksy, open your services list and export it as a CSV, or build a simple name-and-price CSV to upload.',
    clients: 'In Booksy, open Customers and export your client list as a CSV (via Settings or Booksy support if needed).',
    calendar: 'In Booksy, enable calendar sync to get an iCal link, or export your appointments as .ics.',
    calendarFeed: false,
  },
  Square: {
    menu: 'In Square Dashboard, open Items & Services → Actions → Export to download your services as a CSV.',
    clients: 'In Square Dashboard, open Customer Directory → Export customers to download a CSV.',
    calendar:
      'In Square Appointments, enable the calendar subscription to get an iCal feed link you can paste below.',
    calendarFeed: true,
  },
  StyleSeat: {
    menu: 'StyleSeat has no service export — build a quick CSV with a service name and price column and upload that.',
    clients: 'In StyleSeat, open your Clients list and export it as a CSV (Settings → Clients, or via StyleSeat support).',
    calendar: 'In StyleSeat, sync your calendar to get an iCal link, or export your appointments as .ics.',
    calendarFeed: false,
  },
  Fresha: {
    menu: 'In Fresha, open Catalog → Services and export your service list as a CSV.',
    clients: 'In Fresha, open Clients and use Export to download your client list as a CSV.',
    calendar: 'In Fresha, turn on calendar sync to get an iCal link, or export your appointments as .ics.',
    calendarFeed: false,
  },
  Acuity: {
    menu: 'In Acuity, open your Appointment Types and export them, or build a quick name-and-price CSV.',
    clients: 'In Acuity, open Client List → Import/Export and export your clients as a CSV.',
    calendar:
      'In Acuity, copy your calendar Subscribe (iCal) feed URL and paste it below to keep bookings in sync.',
    calendarFeed: true,
  },
  Other: GENERIC,
}

export function exportGuideFor(source: SourceApp): MigrationExportGuide {
  return EXPORT_GUIDES[source]
}

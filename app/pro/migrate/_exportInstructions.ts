// app/pro/migrate/_exportInstructions.ts
//
// Per-source export guidance for the migration funnel. When a pro picks the app
// they're coming from on the entry page, we show them exactly how to get the
// three files this flow needs (service menu, client list, calendar) out of that
// app. Data-only + brand-neutral (every step is about the SOURCE app, never
// ours), so it lives beside _constants.ts rather than in lib/brand.
//
// Every guide below was fact-checked against the source app's official help
// docs (or, where those are silent, the migration guides of vendors who run
// concierge imports from that app) on 2026-07-15 — sources in the PR that
// landed this revision; re-verify before editing a path here. Several
// apps have NO self-serve export for a given stage; the guide then says so and
// leads with the build-a-CSV fallback instead of pointing at a screen that
// doesn't exist. The universal fallback (see MigrationCopy.entry.exportGuide)
// reinforces that a plain CSV always works.

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
    'Open your client or customer list and export/download it as a CSV or Excel file — both upload fine. Look under Settings, Reports, or the list’s ••• / Export menu.',
  calendar:
    'Turn on calendar sync to get an iCal (.ics) link, or export your appointments as an .ics file.',
  calendarFeed: false,
}

export const EXPORT_GUIDES: Record<SourceApp, MigrationExportGuide> = {
  Vagaro: {
    menu: 'Vagaro’s service list downloads per stylist: Settings → Employees → Employee Profiles → pick the stylist → Services → the download icon (choose Excel — it uploads as-is, and you can pick several files at once). Or just build a quick name-and-price CSV for the whole menu.',
    clients:
      'In Vagaro (owner login), go to Reports → Customers → Customers, run the report, then Export → Excel. The Excel file uploads as-is.',
    calendar:
      'In Vagaro on the web, open Calendar and choose Export to iCal to download an .ics of the view on screen. Already had Apple/Outlook calendar sync connected? That subscribe link still works — paste it below.',
    calendarFeed: false,
  },
  GlossGenius: {
    menu: 'GlossGenius has no service-list export — build a quick CSV with a service name and price column and upload that (we match each name to the catalog as you go).',
    clients:
      'Log in to GlossGenius in a web browser (the mobile app can’t export; owner account only) and open Clients → Export Clients to download a CSV.',
    calendar:
      'In GlossGenius, open calendar sync (Settings → Preferences → Two-Way Calendar Sync) and Copy Calendar Link — paste that link below. It’s the only GlossGenius export that includes upcoming appointments.',
    calendarFeed: true,
  },
  Booksy: {
    menu: 'Booksy has no service-list export — build a quick CSV with a service name and price column and upload that.',
    clients:
      'In Booksy Biz on desktop, open Clients → More Options → Export to download a CSV. Don’t see it? Ask Booksy support (in-app chat or info.us@booksy.com) for your client list as a CSV.',
    calendar:
      'Booksy can’t export a calendar or iCal file (its calendar tools only import INTO Booksy). Ask Booksy support for a list of your upcoming appointments, or add them here by hand.',
    calendarFeed: false,
  },
  Square: {
    menu: 'Square can’t export Appointments services (the Item library export covers retail items only) — build a quick CSV with a service name and price column and upload that.',
    clients:
      'In Square Dashboard, go to Customers → Customer directory → Import/Export → Export customers to download a CSV.',
    calendar:
      'Square has no iCal feed of its own. In Appointments → Settings → Calendar & booking, link Google Calendar (export only), then paste your Google Calendar’s private iCal address below to bring bookings in.',
    calendarFeed: false,
  },
  StyleSeat: {
    menu: 'StyleSeat has no service export — build a quick CSV with a service name and price column and upload that.',
    clients:
      'In StyleSeat, open your Clients tab and tap ••• → Export Client List. StyleSeat emails the CSV to your verified email address — check your inbox (and spam) rather than waiting for a download.',
    calendar:
      'StyleSeat can’t export appointments (its calendar sync only pulls your personal calendar in). Ask StyleSeat support for an appointments list, or add upcoming bookings here by hand.',
    calendarFeed: false,
  },
  Fresha: {
    menu: 'In Fresha, open Catalog → Service menu and use Options → Export to download your service list as a CSV.',
    clients:
      'In Fresha, open Clients → Options → Export to download your client list as a CSV (on team accounts this needs the “Can download clients” permission).',
    calendar:
      'In Fresha, open Calendar sync (profile picture → Manage workspace → Calendar sync), choose Other Calendars → Export your Fresha Calendar, and paste the link below. Fresha hides client and service details in that feed, so bookings arrive as held time slots.',
    calendarFeed: true,
  },
  Acuity: {
    menu: 'Acuity has no appointment-type export — build a quick CSV with a service name and price column and upload that.',
    clients:
      'In Acuity, open Clients → Import/export → Export client list to download a CSV.',
    calendar:
      'In Acuity, open Sync with Other Calendars → 1-way Calendar Sync and copy the link at the bottom of the page — paste it below to keep bookings in sync (clicking the link instead downloads a one-time .ics).',
    calendarFeed: true,
  },
  Other: GENERIC,
}

export function exportGuideFor(source: SourceApp): MigrationExportGuide {
  return EXPORT_GUIDES[source]
}

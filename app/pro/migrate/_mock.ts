// app/pro/migrate/_mock.ts
//
// Presentational mock data for the migration flow. Lets us build + verify the UI
// before the import backend exists. Replaced by real parsed/matched data later.

import type {
  BookingTransferRow,
  CanonicalService,
  ClientImportRow,
  MigrateCalendarViewModel,
  MigrateClientsViewModel,
  MigrateReviewViewModel,
  MigrateServicesViewModel,
  ServiceMapRow,
  TimeBlock,
  WorkingDay,
} from './_types'

export const MOCK_CATALOG: CanonicalService[] = [
  { id: 'svc_balayage', name: 'Balayage', categoryId: 'cat_color', categoryName: 'Hair · Color', minPrice: 120, licensedForPro: true },
  { id: 'svc_root', name: 'Root Touch-Up', categoryId: 'cat_color', categoryName: 'Hair · Color', minPrice: 75, licensedForPro: true },
  { id: 'svc_partial', name: 'Partial Highlights', categoryId: 'cat_color', categoryName: 'Hair · Color', minPrice: 95, licensedForPro: true },
  { id: 'svc_cut', name: 'Haircut & Style', categoryId: 'cat_haircut', categoryName: 'Hair · Haircut', minPrice: 55, licensedForPro: true },
  { id: 'svc_blowout', name: 'Blowout', categoryId: 'cat_haircut', categoryName: 'Hair · Haircut', minPrice: 45, licensedForPro: true },
  { id: 'svc_gelx', name: 'Gel-X Full Set', categoryId: 'cat_nails', categoryName: 'Nails · Enhancements', minPrice: 65, licensedForPro: true },
  { id: 'svc_glam', name: 'Soft Glam Makeup', categoryId: 'cat_makeup', categoryName: 'Makeup', minPrice: 90, licensedForPro: true },
  { id: 'svc_swedish', name: '60-Minute Swedish Massage', categoryId: 'cat_massage', categoryName: 'Massage', minPrice: 95, licensedForPro: false },
  { id: 'svc_lash_full', name: 'Lash Full Set', categoryId: 'cat_lash', categoryName: 'Lashes', minPrice: 110, licensedForPro: true },
  { id: 'svc_lash_fill', name: 'Lash Fill', categoryId: 'cat_lash', categoryName: 'Lashes', minPrice: 60, licensedForPro: true },
  { id: 'svc_brow', name: 'Brow Wax', categoryId: 'cat_wax', categoryName: 'Waxing', minPrice: 25, licensedForPro: true },
]

const MOCK_ROWS: ServiceMapRow[] = [
  {
    rowId: 'r1',
    sourceName: 'Balayage',
    sourcePrice: 110,
    sourceDurationMinutes: 180,
    suggestedServiceId: 'svc_balayage',
    selection: { kind: 'MAP', serviceId: 'svc_balayage' },
    offering: { salonPrice: 110, salonDurationMinutes: 180, offersInSalon: true, offersMobile: false },
    priceGrace: { platformMin: 120, grandfatheredPrice: 110, step: { mode: 'PCT', value: 10 }, cadenceWeeks: 10 },
    status: 'PRICE_GRACE',
  },
  {
    rowId: 'r2',
    sourceName: 'Root Color Retouch',
    sourcePrice: 80,
    sourceDurationMinutes: 90,
    suggestedServiceId: 'svc_root',
    selection: { kind: 'MAP', serviceId: 'svc_root' },
    offering: { salonPrice: 80, salonDurationMinutes: 90, offersInSalon: true, offersMobile: false },
    status: 'OK',
  },
  {
    rowId: 'r3',
    sourceName: "Women's Cut + Style",
    sourcePrice: 65,
    sourceDurationMinutes: 60,
    suggestedServiceId: 'svc_cut',
    selection: { kind: 'MAP', serviceId: 'svc_cut' },
    offering: { salonPrice: 65, salonDurationMinutes: 60, offersInSalon: true, offersMobile: true },
    status: 'OK',
  },
  {
    rowId: 'r4',
    sourceName: 'Gel-X Full Set',
    sourcePrice: 58,
    sourceDurationMinutes: 75,
    suggestedServiceId: 'svc_gelx',
    selection: { kind: 'MAP', serviceId: 'svc_gelx' },
    offering: { salonPrice: 58, salonDurationMinutes: 75, offersInSalon: true, offersMobile: false },
    priceGrace: { platformMin: 65, grandfatheredPrice: 58, step: { mode: 'PCT', value: 10 }, cadenceWeeks: 10 },
    status: 'PRICE_GRACE',
  },
  {
    rowId: 'r5',
    sourceName: 'Full Glam Makeup',
    sourcePrice: 95,
    sourceDurationMinutes: 60,
    suggestedServiceId: 'svc_glam',
    selection: { kind: 'MAP', serviceId: 'svc_glam' },
    offering: { salonPrice: 95, salonDurationMinutes: 60, offersInSalon: true, offersMobile: true },
    status: 'OK',
  },
  {
    rowId: 'r6',
    sourceName: '60 min Swedish Massage',
    sourcePrice: 100,
    sourceDurationMinutes: 60,
    suggestedServiceId: 'svc_swedish',
    selection: { kind: 'MAP', serviceId: 'svc_swedish' },
    offering: { salonPrice: 100, salonDurationMinutes: 60, offersInSalon: true, offersMobile: false },
    status: 'UNLICENSED',
  },
  {
    rowId: 'r7',
    sourceName: 'Lash Refill (2wk)',
    sourcePrice: 65,
    sourceDurationMinutes: 60,
    suggestedServiceId: null,
    selection: { kind: 'SKIP' },
    offering: { offersInSalon: true, offersMobile: false },
    status: 'NEEDS_ATTENTION',
  },
  {
    rowId: 'r8',
    sourceName: 'Scalp Treatment',
    sourcePrice: 40,
    sourceDurationMinutes: 30,
    suggestedServiceId: null,
    selection: { kind: 'REQUEST_NEW' },
    offering: { offersInSalon: true, offersMobile: false },
    status: 'REQUEST_PENDING',
  },
  {
    rowId: 'r9',
    sourceName: 'Bang Trim',
    sourcePrice: 15,
    sourceDurationMinutes: 15,
    suggestedServiceId: null,
    selection: { kind: 'SKIP' },
    offering: { offersInSalon: true, offersMobile: false },
    status: 'SKIPPED',
  },
]

export function mockServicesViewModel(): MigrateServicesViewModel {
  return {
    sourceApp: 'Vagaro',
    catalog: MOCK_CATALOG,
    columnMappings: [
      { src: 'service_name', dest: 'Your service' },
      { src: 'price', dest: 'Price' },
      { src: 'duration', dest: 'Duration' },
    ],
    rows: MOCK_ROWS,
  }
}

// ── Clients ─────────────────────────────────────────────────────────────────

const MOCK_CLIENT_ROWS: ClientImportRow[] = [
  { rowId: 'c1', firstName: 'Maya', lastName: 'Rodriguez', email: 'maya.r@gmail.com', phone: '(415) 555-0172', lastVisit: 'Apr 2, 2026', visitCount: 14, match: 'AUTO_MATCHED', included: true },
  { rowId: 'c2', firstName: 'Jordan', lastName: 'Lee', email: 'jlee@outlook.com', phone: '(415) 555-0199', lastVisit: 'Mar 18, 2026', visitCount: 6, match: 'NEW', included: true },
  { rowId: 'c3', firstName: 'Priya', lastName: 'Shah', email: 'priya.shah@gmail.com', phone: '(628) 555-0140', lastVisit: 'Feb 27, 2026', visitCount: 9, match: 'POSSIBLE_DUPE', dupeResolution: 'UNRESOLVED', included: true },
  { rowId: 'c4', firstName: 'Taylor', lastName: 'Brooks', lastVisit: 'Jan 9, 2026', visitCount: 2, match: 'MISSING_INFO', included: true },
  { rowId: 'c5', firstName: 'Sam', lastName: 'Nguyen', email: 'sam.nguyen@gmail.com', lastVisit: 'Dec 4, 2025', visitCount: 1, match: 'NEW', included: false },
  { rowId: 'c6', firstName: 'Alex', lastName: 'Carter', phone: '(510) 555-0188', lastVisit: 'Mar 30, 2026', visitCount: 11, match: 'AUTO_MATCHED', included: true },
]

export function mockClientsViewModel(): MigrateClientsViewModel {
  return {
    contactsFound: 47,
    columnMappings: [
      { src: 'full_name', dest: 'Name' },
      { src: 'email', dest: 'Email' },
      { src: 'phone', dest: 'Phone' },
      { src: 'last_appt_date', dest: 'Last visit' },
      { src: 'total_visits', dest: 'Visit count' },
    ],
    rows: MOCK_CLIENT_ROWS,
  }
}

// ── Calendar ────────────────────────────────────────────────────────────────

const MOCK_WORKING_HOURS: WorkingDay[] = [
  { key: 'mon', label: 'Mon', enabled: true, hours: '9–5' },
  { key: 'tue', label: 'Tue', enabled: true, hours: '9–5' },
  { key: 'wed', label: 'Wed', enabled: true, hours: '10–6' },
  { key: 'thu', label: 'Thu', enabled: true, hours: '10–6' },
  { key: 'fri', label: 'Fri', enabled: true, hours: '9–4' },
  { key: 'sat', label: 'Sat', enabled: true, hours: '10–3' },
  { key: 'sun', label: 'Sun', enabled: false },
]

const MOCK_TIME_BLOCKS: TimeBlock[] = [
  { id: 'b1', label: 'Lunch', range: '1:00–2:00 PM', cadence: 'Daily' },
  { id: 'b2', label: 'Admin', range: '4:00–5:00 PM', cadence: 'Fridays' },
]

const MOCK_BOOKINGS: BookingTransferRow[] = [
  { rowId: 'bk1', startLabel: 'Tue Jun 17 · 10:00 AM', clientName: 'Maya Rodriguez', serviceName: 'Balayage', durationMinutes: 180, status: 'CONFIRMED', transfer: true },
  { rowId: 'bk2', startLabel: 'Wed Jun 18 · 1:30 PM', clientName: 'Alex Carter', serviceName: 'Haircut & Style', durationMinutes: 60, status: 'PENDING', transfer: true, conflictNote: "Overlaps with 'Lunch' block — booking will take priority" },
  { rowId: 'bk3', startLabel: 'Thu Jun 19 · 11:00 AM', clientName: 'Jordan Lee', serviceName: 'Soft Glam Makeup', durationMinutes: 60, status: 'CONFIRMED', transfer: true },
  { rowId: 'bk4', startLabel: 'Fri Jun 20 · 2:00 PM', clientName: 'Priya Shah', serviceName: 'Root Touch-Up', durationMinutes: 90, status: 'SKIPPED', transfer: false },
]

export function mockCalendarViewModel(): MigrateCalendarViewModel {
  return {
    workingHours: MOCK_WORKING_HOURS,
    bufferMinutes: 15,
    advanceWeeks: 8,
    timeBlocks: MOCK_TIME_BLOCKS,
    bookings: MOCK_BOOKINGS,
    pastVisitsCount: 312,
  }
}

// ── Review ──────────────────────────────────────────────────────────────────

export function mockReviewViewModel(): MigrateReviewViewModel {
  return {
    cards: [
      {
        key: 'services',
        tone: 'gold',
        title: 'Service menu',
        subtitle: 'Mapped to the catalog',
        stats: [
          { value: '5', label: 'added' },
          { value: '2', label: 'raises' },
          { value: '1', label: 'skipped' },
        ],
        editLabel: 'Edit services',
        editHref: '/pro/migrate/services',
      },
      {
        key: 'clients',
        tone: 'accent',
        title: 'Clients',
        subtitle: 'Matched and de-duplicated',
        stats: [
          { value: '42', label: 'imported' },
          { value: '31', label: 'matched' },
          { value: '1', label: 'merged' },
        ],
        editLabel: 'Edit clients',
        editHref: '/pro/migrate/clients',
      },
      {
        key: 'calendar',
        tone: 'violet',
        title: 'Calendar',
        subtitle: 'Bookings + working hours',
        stats: [
          { value: '3', label: 'booking' },
          { value: '1', label: 'conflict' },
          { value: '312', label: 'past visits' },
        ],
        editLabel: 'Edit calendar',
        editHref: '/pro/migrate/calendar',
      },
    ],
    raiseRecap: [
      { serviceName: 'Balayage', from: 110, to: 120, cadenceLabel: '10% / 10 wks' },
      { serviceName: 'Gel-X Full Set', from: 58, to: 65, cadenceLabel: '10% / 10 wks' },
    ],
    checklist: [
      { label: 'Service menu reviewed', done: true },
      { label: 'Clients imported (42 contacts, 31 matched, 1 dupe merged)', done: true },
      { label: 'Calendar transferred', done: true },
      { label: 'No notifications sent yet', done: true },
    ],
  }
}

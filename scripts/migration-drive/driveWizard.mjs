// scripts/migration-drive/driveWizard.mjs
//
// Drives the live migration wizard on localhost:3001 end-to-end with a cookie
// jar: login → parse CSVs → services preview+commit (incl. ramp rows on
// below-min prices) → clients preview+commit → hand-built .ics preview+commit.
// Prints one JSON blob per stage so the run can be audited stage by stage.

const BASE = process.env.DRIVE_BASE ?? 'http://localhost:3001'
const EMAIL = process.argv[2]
const PASSWORD = 'TestPassword123!'
const { readFileSync } = await import('node:fs')

if (!EMAIL) {
  console.error('usage: node scripts/migration-drive/driveWizard.mjs <pro-email>')
  process.exit(1)
}

let cookie = ''

async function call(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      // The edge proxy's CSRF defense requires state-changing requests to carry
      // an Origin matching the request host — same as the wizard UI itself.
      origin: BASE,
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const setCookie = res.headers.get('set-cookie')
  if (setCookie) {
    const pair = setCookie.split(';')[0]
    if (pair.startsWith('tovis_token=')) cookie = pair
  }
  let json = null
  try {
    json = await res.json()
  } catch {}
  return { status: res.status, json }
}

function b64(path) {
  return readFileSync(new URL(path, import.meta.url)).toString('base64')
}

function csvRows(text) {
  const [headerLine, ...lines] = text.trim().split(/\r?\n/)
  const headers = headerLine.split(',').map((h) => h.trim())
  return lines.map((line) => {
    const cells = line.split(',')
    const row = {}
    headers.forEach((h, i) => {
      row[h] = (cells[i] ?? '').trim()
    })
    return row
  })
}

function daysFromNow(days, hourUtc, minuteUtc = 0) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  d.setUTCHours(hourUtc, minuteUtc, 0, 0)
  return d
}

// Fresh UIDs per run. The import's idempotency keys are `import:<uid>`, and
// until that key is pro-scoped (OPEN-WORK.md item 1) two drives against
// different pros sharing a UID collide on (clientId, creationIdempotencyKey)
// and the second pro silently imports nothing — so the driver must never
// reuse a UID across runs.
const RUN = Date.now().toString(36)
const uid = (name) => `${name}-${RUN}@tovis.test`

function icsStamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function dayStamp(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '')
}

// ── 1. login ──────────────────────────────────────────────────────────────────
const login = await call('POST', '/api/v1/auth/login', { email: EMAIL, password: PASSWORD })
console.log(JSON.stringify({ stage: 'login', status: login.status, ok: login.json?.ok }))
if (!login.json?.ok || !cookie) {
  console.error('login failed', JSON.stringify(login))
  process.exit(1)
}

// ── 2. parse both CSVs ────────────────────────────────────────────────────────
const servicesCsv = readFileSync(
  new URL('./booksy-services.csv', import.meta.url),
  'utf8',
)
const clientsCsvText = readFileSync(
  new URL('./booksy-clients.csv', import.meta.url),
  'utf8',
)

const parseServices = await call('POST', '/api/v1/pro/migrate/parse', {
  contentBase64: b64('./booksy-services.csv'),
})
const parseClients = await call('POST', '/api/v1/pro/migrate/parse', {
  contentBase64: b64('./booksy-clients.csv'),
})
console.log(
  JSON.stringify({
    stage: 'parse',
    services: {
      status: parseServices.status,
      headers: parseServices.json?.headers,
      rowCount: parseServices.json?.rows?.length,
      truncated: parseServices.json?.truncated,
    },
    clients: {
      status: parseClients.status,
      headers: parseClients.json?.headers,
      rowCount: parseClients.json?.rows?.length,
    },
  }),
)

// ── 3. services preview + commit ──────────────────────────────────────────────
const menuRows = csvRows(servicesCsv).map((r) => ({
  name: r['Service'],
  price: r['Price'] === '' ? null : Number(r['Price']),
  durationMinutes: r['Duration'] === '' ? null : Number(r['Duration']),
}))

const svcPreview = await call('POST', '/api/v1/pro/migrate/services/preview', {
  rows: menuRows,
})
const catalog = svcPreview.json?.catalog ?? []
const svcRowsIn = svcPreview.json?.rows ?? []
console.log(
  JSON.stringify({
    stage: 'services-preview',
    status: svcPreview.status,
    catalogSize: catalog.length,
    rows: svcRowsIn.map((r) => ({
      sourceName: r.sourceName,
      sourcePrice: r.sourcePrice,
      bestServiceId: r.bestServiceId,
      topSuggestion: r.suggestions?.[0]?.name ?? null,
      topScore: r.suggestions?.[0]?.score ?? null,
    })),
  }),
)

// One decision per CSV row. Confident matches use bestServiceId; anything the
// matcher would not pre-select falls back to the first unused catalog entry so
// every row still exercises the commit path. Deep Conditioning gets a deliberate
// below-minimum price ($5) to force a ramp; Color Correction keeps null price.
const used = new Set()
const svcDecisions = svcRowsIn.map((row) => {
  let serviceId = row.bestServiceId
  if (!serviceId || used.has(serviceId)) {
    const fallback = catalog.find((c) => !used.has(c.id))
    serviceId = fallback?.id
  }
  if (serviceId) used.add(serviceId)
  const isDeepCond = row.sourceName === 'Deep Conditioning Treatment'
  const salonPrice = isDeepCond ? 5 : (row.sourcePrice ?? 85)
  return {
    serviceId,
    offersInSalon: Boolean(serviceId),
    offersMobile: false,
    salonPrice,
    salonDurationMinutes: row.sourceDurationMinutes ?? 60,
    mobilePrice: null,
    mobileDurationMinutes: null,
    ramp: { stepMode: 'PCT', stepValue: 10, cadenceWeeks: 10 },
  }
})

const svcCommit = await call('POST', '/api/v1/pro/migrate/services/commit', {
  decisions: svcDecisions,
})
console.log(
  JSON.stringify({
    stage: 'services-commit',
    status: svcCommit.status,
    summary: svcCommit.json?.summary,
    rows: svcCommit.json?.rows,
  }),
)

// ── 4. clients preview + commit ───────────────────────────────────────────────
const clientRawRows = csvRows(clientsCsvText)
const mapping = {
  firstName: 'First Name',
  lastName: 'Last Name',
  email: 'Email',
  phone: 'Cell Phone',
}

const cliPreview = await call('POST', '/api/v1/pro/migrate/clients/preview', {
  rows: clientRawRows,
  mapping,
})
console.log(
  JSON.stringify({
    stage: 'clients-preview',
    status: cliPreview.status,
    summary: cliPreview.json?.summary,
    rows: cliPreview.json?.rows,
  }),
)

const excludeIndices = (cliPreview.json?.rows ?? [])
  .filter((r) => !r.importable)
  .map((r) => r.index)

const cliCommit = await call('POST', '/api/v1/pro/migrate/clients/commit', {
  rows: clientRawRows,
  mapping,
  excludeIndices,
})
console.log(
  JSON.stringify({
    stage: 'clients-commit',
    status: cliCommit.status,
    excludeIndices,
    summary: cliCommit.json?.summary,
    rows: cliCommit.json?.rows,
  }),
)

// ── 5. calendar: hand-built .ics preview + commit ─────────────────────────────
const futureStart = daysFromNow(3, 18, 0) // 18:00Z ≈ 11:00 PDT
const futureEnd = daysFromNow(3, 19, 30)
const pastStart = daysFromNow(-7, 20, 0)
const pastEnd = daysFromNow(-7, 21, 30)
const allDayDate = dayStamp(daysFromNow(5, 12, 0))
const recurStart = daysFromNow(4, 17, 0)
const recurEnd = daysFromNow(4, 18, 0)

const ics = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//Tovis Migration Drive//EN',
  'BEGIN:VEVENT',
  `UID:${uid('drive-future-booking')}`,
  `DTSTAMP:${icsStamp(new Date())}`,
  `DTSTART:${icsStamp(futureStart)}`,
  `DTEND:${icsStamp(futureEnd)}`,
  'SUMMARY:Balayage',
  'ATTENDEE;CN=Nina Torres:mailto:nina.torres@example.com',
  'END:VEVENT',
  'BEGIN:VEVENT',
  `UID:${uid('drive-past-history')}`,
  `DTSTAMP:${icsStamp(new Date())}`,
  `DTSTART:${icsStamp(pastStart)}`,
  `DTEND:${icsStamp(pastEnd)}`,
  'SUMMARY:Full Highlights',
  'ATTENDEE;CN=Maria Santos:mailto:maria.santos@example.com',
  'END:VEVENT',
  'BEGIN:VEVENT',
  `UID:${uid('drive-allday-block')}`,
  `DTSTAMP:${icsStamp(new Date())}`,
  `DTSTART;VALUE=DATE:${allDayDate}`,
  'SUMMARY:Closed - Staff Training',
  'END:VEVENT',
  'BEGIN:VEVENT',
  `UID:${uid('drive-recurring')}`,
  `DTSTAMP:${icsStamp(new Date())}`,
  `DTSTART:${icsStamp(recurStart)}`,
  `DTEND:${icsStamp(recurEnd)}`,
  'RRULE:FREQ=WEEKLY',
  'SUMMARY:Root Touch-Up',
  'ATTENDEE;CN=Kim Park:mailto:kim.park@example.com',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n')

const calPreview = await call('POST', '/api/v1/pro/migrate/calendar/preview', {
  ics,
})
console.log(
  JSON.stringify({
    stage: 'calendar-preview',
    status: calPreview.status,
    summary: calPreview.json?.summary,
    rows: calPreview.json?.rows,
  }),
)

const calCommit = await call('POST', '/api/v1/pro/migrate/calendar/commit', {
  ics,
  excludeUids: [],
})
console.log(
  JSON.stringify({
    stage: 'calendar-commit',
    status: calCommit.status,
    json: calCommit.json,
  }),
)

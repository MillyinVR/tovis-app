import { NextResponse } from 'next/server'
import { requireEnv } from '@/lib/env'
import { isRecord } from '@/lib/guards'
import { getCurrentUser } from '@/lib/currentUser'
import { enforceRateLimit, rateLimitIdentity } from '@/app/api/_utils/rateLimit'
import { pickStringOr, pickStringOrEmpty } from '@/lib/pick'
import {
  dcaLicenseQueryNumber,
  isCurrentStatusCode,
  licenseNumbersMatch,
  parseDcaLicenseRecord,
  parseDcaNameDetails,
} from '@/lib/licensing/caDcaLicense'

// States with automated verification (backed by DCA BreEZe API).
const AUTOMATED_STATES = new Set(['CA'])

// States that go through manual review instead of automated verification.
// Set PENDING_MANUAL_REVIEW so pros can continue listing while review is in progress.
const MANUAL_REVIEW_STATES = new Set(['NY', 'TX', 'FL'])

type Profession =
  | 'COSMETOLOGIST'
  | 'BARBER'
  | 'ESTHETICIAN'
  | 'MANICURIST'
  | 'HAIRSTYLIST'
  | 'ELECTROLOGIST'

type VerifyReq = {
  state: string
  profession: Profession
  licenseNumber: string
}

type DcaLicenseType = {
  clientCode?: unknown
  licenseLongName?: unknown
  publicNameDesc?: unknown
}

type DcaLicenseTypeGroup = {
  licenseTypes?: unknown
}

type DcaLicenseTypesResponse = {
  message?: unknown
  error?: unknown
  getAllLicenseTypes?: unknown
}

type DcaLicenseSearchResponse = {
  error?: unknown
  licenseDetails?: unknown
}

function isDcaLicenseTypeGroup(value: unknown): value is DcaLicenseTypeGroup {
  return isRecord(value)
}

function isDcaLicenseType(value: unknown): value is DcaLicenseType {
  return isRecord(value)
}

// CA BBC license “types” come from DCA’s BreEZe license types list.
// For the demo we resolve them by fetching license types once and matching by name.
let cachedTypeMap: Record<Profession, string> | null = null
let cachedTypeMapExp = 0

async function getBreezeTypeMap(): Promise<Record<Profession, string>> {
  const now = Date.now()
  if (cachedTypeMap && now < cachedTypeMapExp) return cachedTypeMap

  const APP_ID = requireEnv('DCA_SEARCH_APP_ID')
  const APP_KEY = requireEnv('DCA_SEARCH_APP_KEY')

  const base = 'https://iservices.dca.ca.gov/api/v1/search/v1'
  const url = `${base}/breezeDetailService/getAllLicenseTypes`

  const res = await fetch(url, {
    headers: { APP_ID, APP_KEY },
    cache: 'no-store',
  })

  const data = (await res
    .json()
    .catch(() => ({}))) as DcaLicenseTypesResponse

  if (!res.ok) {
    throw new Error(
      pickStringOr(
        data.message,
        pickStringOr(data.error, 'DCA license types lookup failed'),
      ),
    )
  }

  const rows = Array.isArray(data.getAllLicenseTypes)
    ? data.getAllLicenseTypes.filter(isDcaLicenseTypeGroup)
    : []

  const allTypes = rows.flatMap((row) =>
    Array.isArray(row.licenseTypes)
      ? row.licenseTypes.filter(isDcaLicenseType)
      : [],
  )

  const pick = (needle: string): string | null => {
    const hit = allTypes.find((type) => {
      const licenseLongName = pickStringOrEmpty(
        type.licenseLongName,
      ).toUpperCase()

      const publicNameDesc = pickStringOrEmpty(
        type.publicNameDesc,
      ).toUpperCase()

      return licenseLongName.includes(needle) || publicNameDesc.includes(needle)
    })

    return typeof hit?.clientCode === 'string' && hit.clientCode.trim()
      ? hit.clientCode
      : null
  }

  const map: Record<Profession, string> = {
    COSMETOLOGIST: pick('COSMETOLOG') ?? '',
    BARBER: pick('BARBER') ?? '',
    ESTHETICIAN: pick('ESTHETIC') ?? '',
    MANICURIST: pick('MANICUR') ?? '',
    HAIRSTYLIST: pick('HAIRSTYL') ?? '',
    ELECTROLOGIST: pick('ELECTRO') ?? '',
  }

  const missing = Object.entries(map)
    .filter(([, value]) => !value)
    .map(([key]) => key)

  if (missing.length) {
    throw new Error(
      `Could not resolve DCA licType codes for: ${missing.join(
        ', ',
      )}. (Check DCA license types response for exact names.)`,
    )
  }

  cachedTypeMap = map
  cachedTypeMapExp = now + 6 * 60 * 60 * 1000 // 6h
  return map
}

function isProfession(value: string): value is Profession {
  return (
    value === 'COSMETOLOGIST' ||
    value === 'BARBER' ||
    value === 'ESTHETICIAN' ||
    value === 'MANICURIST' ||
    value === 'HAIRSTYLIST' ||
    value === 'ELECTROLOGIST'
  )
}

export async function POST(req: Request) {
  try {
    // This route proxies the CA DCA BreEZe government API using the platform's
    // secret credentials and returns licensee PII. Require an authenticated user and
    // throttle per-user so it can't be used to enumerate licensees or burn the
    // government API quota.
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json(
        { ok: false, error: 'Authentication required.' },
        { status: 401 },
      )
    }

    const limited = await enforceRateLimit({
      bucket: 'pro-license:verify',
      identity: await rateLimitIdentity(user.id),
    })
    if (limited) return limited

    const body = (await req.json().catch(() => ({}))) as Partial<VerifyReq>

    const state = String(body.state ?? '').trim().toUpperCase()
    const professionRaw = String(body.profession ?? '').trim().toUpperCase()
    const licenseNumber = String(body.licenseNumber ?? '').trim().toUpperCase()

    if (!state) {
      return NextResponse.json(
        { ok: false, error: 'State is required.' },
        { status: 400 },
      )
    }

    if (!isProfession(professionRaw)) {
      return NextResponse.json(
        { ok: false, error: 'Unsupported profession.' },
        { status: 400 },
      )
    }

    const profession = professionRaw

    // Non-automated states: queue for manual review instead of rejecting.
    if (!AUTOMATED_STATES.has(state)) {
      const isKnownState = MANUAL_REVIEW_STATES.has(state)

      return NextResponse.json({
        ok: true,
        status: 'PENDING_MANUAL_REVIEW',
        source: isKnownState ? `${state}_MANUAL_REVIEW` : 'MANUAL_REVIEW',
        profession,
        licenseNumber,
        state,
        message: isKnownState
          ? `Automated verification is not yet available for ${state}. Your license will be reviewed manually within 2 business days.`
          : 'Automated verification is not yet available for your state. Your license will be reviewed manually within 2 business days.',
      })
    }

    if (licenseNumber.length < 4) {
      return NextResponse.json(
        { ok: false, error: 'Enter a valid license number.' },
        { status: 400 },
      )
    }

    const typeMap = await getBreezeTypeMap()
    const licType = typeMap[profession]

    if (!licType) {
      return NextResponse.json(
        { ok: false, error: 'Unsupported profession.' },
        { status: 400 },
      )
    }

    const APP_ID = requireEnv('DCA_SEARCH_APP_ID')
    const APP_KEY = requireEnv('DCA_SEARCH_APP_KEY')

    const base = 'https://iservices.dca.ca.gov/api/v1/search/v1'
    const url = new URL(`${base}/licenseSearchService/getLicenseNumberSearch`)
    url.searchParams.set('licType', licType)
    // BreEZe keys on the numeric portion, not the prefix printed on the card.
    url.searchParams.set('licNumber', dcaLicenseQueryNumber(licenseNumber))

    const res = await fetch(url.toString(), {
      headers: { APP_ID, APP_KEY },
      cache: 'no-store',
    })

    const data = (await res
      .json()
      .catch(() => ({}))) as DcaLicenseSearchResponse

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: pickStringOr(data.error, 'License lookup failed.'),
        },
        { status: res.status },
      )
    }

    const record = parseDcaLicenseRecord(data)

    // A 200 we cannot read as a license record — empty body, a 200-shaped
    // gateway error page, or schema drift — is not evidence that a license is
    // bad. Say so honestly and send it to manual review instead of reporting a
    // failure the pro cannot act on.
    if (!record) {
      return NextResponse.json({
        ok: true,
        status: 'PENDING_MANUAL_REVIEW',
        source: 'CA_DCA_BREEZE',
        profession,
        licenseNumber,
        state,
        primaryStatusCode: null,
        issueDate: null,
        expDate: null,
        name: null,
        message:
          'We could not read a response from the state license system. Your license will be reviewed manually within 2 business days.',
      })
    }

    // A record filed under a different number says nothing about this pro's
    // license — neither confirming nor disqualifying it.
    const numberMatches = licenseNumbersMatch(
      record.licNumber ?? '',
      licenseNumber,
    )

    if (!numberMatches) {
      return NextResponse.json({
        ok: true,
        status: 'PENDING_MANUAL_REVIEW',
        source: 'CA_DCA_BREEZE',
        profession,
        licenseNumber,
        state,
        primaryStatusCode: record.statusCode,
        issueDate: record.issueDate,
        expDate: record.expDate,
        name: null,
        message:
          'The state record we found is under a different license number. Your license will be reviewed manually within 2 business days.',
      })
    }

    const verified = isCurrentStatusCode(record.statusCode)

    return NextResponse.json({
      ok: true,
      status: verified ? 'VERIFIED' : 'FAILED',
      source: 'CA_DCA_BREEZE',
      profession,
      licenseNumber,
      primaryStatusCode: record.statusCode,
      issueDate: record.issueDate,
      expDate: record.expDate,
      name: parseDcaNameDetails(data),
      // NOTE: the full upstream `data` payload is intentionally NOT returned —
      // it carries unredacted government record fields. If an audit snapshot is
      // needed, persist it server-side rather than leaking it to the client.
    })
  } catch (error: unknown) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : 'Verification error.',
      },
      { status: 500 },
    )
  }
}
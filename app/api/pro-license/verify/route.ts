import { NextResponse } from 'next/server'

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

type DcaLicenseDetail = {
  licNumber?: unknown
  primaryStatusCode?: unknown
  issueDate?: unknown
  expDate?: unknown
}

type DcaNameDetail = {
  firstName?: unknown
  lastName?: unknown
}

type DcaFullLicenseDetail = {
  getLicenseDetails?: unknown
  getNameDetails?: unknown
}

type DcaLicenseDetailsRoot = {
  getFullLicenseDetail?: unknown
}

type DcaLicenseSearchResponse = {
  error?: unknown
  licenseDetails?: unknown
}

function mustEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Missing env: ${name}`)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function stringFromUnknown(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function errorMessageFromUnknown(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function isDcaLicenseTypeGroup(value: unknown): value is DcaLicenseTypeGroup {
  return isRecord(value)
}

function isDcaLicenseType(value: unknown): value is DcaLicenseType {
  return isRecord(value)
}

function isDcaLicenseDetailsRoot(
  value: unknown,
): value is DcaLicenseDetailsRoot {
  return isRecord(value)
}

function isDcaFullLicenseDetail(value: unknown): value is DcaFullLicenseDetail {
  return isRecord(value)
}

function isDcaLicenseDetail(value: unknown): value is DcaLicenseDetail {
  return isRecord(value)
}

function isDcaNameDetail(value: unknown): value is DcaNameDetail {
  return isRecord(value)
}

function firstArrayItem<T>(
  value: unknown,
  guard: (entry: unknown) => entry is T,
): T | null {
  if (!Array.isArray(value)) return null
  const first = value[0]
  return guard(first) ? first : null
}

// CA BBC license “types” come from DCA’s BreEZe license types list.
// For the demo we resolve them by fetching license types once and matching by name.
let cachedTypeMap: Record<Profession, string> | null = null
let cachedTypeMapExp = 0

async function getBreezeTypeMap(): Promise<Record<Profession, string>> {
  const now = Date.now()
  if (cachedTypeMap && now < cachedTypeMapExp) return cachedTypeMap

  const APP_ID = mustEnv('DCA_SEARCH_APP_ID')
  const APP_KEY = mustEnv('DCA_SEARCH_APP_KEY')

  const base = 'https://iservices.dca.ca.gov/api/search/v1'
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
      errorMessageFromUnknown(
        data.message,
        errorMessageFromUnknown(data.error, 'DCA license types lookup failed'),
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
      const licenseLongName = stringFromUnknown(
        type.licenseLongName,
      ).toUpperCase()

      const publicNameDesc = stringFromUnknown(
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

    const APP_ID = mustEnv('DCA_SEARCH_APP_ID')
    const APP_KEY = mustEnv('DCA_SEARCH_APP_KEY')

    const base = 'https://iservices.dca.ca.gov/api/search/v1'
    const url = new URL(`${base}/licenseSearchService/getLicenseNumberSearch`)
    url.searchParams.set('licType', licType)
    url.searchParams.set('licNumber', licenseNumber)

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
          error: errorMessageFromUnknown(data.error, 'License lookup failed.'),
        },
        { status: res.status },
      )
    }

    const detailsRoot = Array.isArray(data.licenseDetails)
      ? data.licenseDetails.filter(isDcaLicenseDetailsRoot)
      : []

    const firstRoot = detailsRoot[0] ?? null
    const full = firstArrayItem(
      firstRoot?.getFullLicenseDetail,
      isDcaFullLicenseDetail,
    )

    const lic = firstArrayItem(full?.getLicenseDetails, isDcaLicenseDetail)

    const nameDetailsRoot = firstArrayItem(full?.getNameDetails, isRecord)
    const nameBlock = firstArrayItem(
      nameDetailsRoot?.individualNameDetails,
      isDcaNameDetail,
    )

    const returnedLicenseNumber = stringFromUnknown(lic?.licNumber).toUpperCase()
    const primaryStatusCode = stringFromUnknown(
      lic?.primaryStatusCode,
    ).toUpperCase()

    const verified =
      Boolean(returnedLicenseNumber) &&
      returnedLicenseNumber === licenseNumber &&
      primaryStatusCode.includes('CURRENT')

    return NextResponse.json({
      ok: true,
      status: verified ? 'VERIFIED' : 'FAILED',
      source: 'CA_DCA_BREEZE',
      profession,
      licenseNumber,
      primaryStatusCode: lic?.primaryStatusCode ?? null,
      issueDate: lic?.issueDate ?? null,
      expDate: lic?.expDate ?? null,
      name: nameBlock
        ? {
            firstName:
              typeof nameBlock.firstName === 'string'
                ? nameBlock.firstName
                : null,
            lastName:
              typeof nameBlock.lastName === 'string'
                ? nameBlock.lastName
                : null,
          }
        : null,
      raw: data, // for audit/demo; later store a snapshot server-side
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
import { NextResponse } from 'next/server'

type VerifyReq = {
  state: 'CA'
  profession: 'COSMETOLOGIST' | 'BARBER' | 'ESTHETICIAN' | 'MANICURIST' | 'HAIRSTYLIST' | 'ELECTROLOGIST'
  licenseNumber: string
}

function mustEnv(name: string) {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env: ${name}`)
  return v
}

// CA BBC license “types” come from DCA’s BreEZe license types list.
// For the demo we resolve them by fetching license types once and matching by name.
let cachedTypeMap: Record<string, string> | null = null
let cachedTypeMapExp = 0

async function getBreezeTypeMap(): Promise<Record<string, string>> {
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

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(data?.message || data?.error || 'DCA license types lookup failed')
  }

  // Shape per schema: { getAllLicenseTypes: [{ parentClientCode, licenseTypes: [{ clientCode, licenseLongName, publicNameDesc, ... }] }] }
  const rows = Array.isArray(data?.getAllLicenseTypes) ? data.getAllLicenseTypes : []
  const allTypes: any[] = rows.flatMap((r: any) => (Array.isArray(r?.licenseTypes) ? r.licenseTypes : []))

  // We try to match BBC by “publicNameDesc / licenseLongName” containing Barbering/Cosmetology.
  // This is intentionally defensive. If matching fails, we error with enough info to fix quickly.
  const pick = (needle: string) => {
    const hit = allTypes.find((t) => {
      const n = String(t?.licenseLongName ?? '').toUpperCase()
      const p = String(t?.publicNameDesc ?? '').toUpperCase()
      return n.includes(needle) || p.includes(needle)
    })
    return hit?.clientCode ? String(hit.clientCode) : null
  }

  const map: Record<string, string> = {}
  map.COSMETOLOGIST = pick('COSMETOLOG') ?? ''
  map.BARBER = pick('BARBER') ?? ''
  map.ESTHETICIAN = pick('ESTHETIC') ?? ''
  map.MANICURIST = pick('MANICUR') ?? ''
  map.HAIRSTYLIST = pick('HAIRSTYL') ?? ''
  map.ELECTROLOGIST = pick('ELECTRO') ?? ''

  // Ensure we actually resolved something meaningful
  const missing = Object.entries(map).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) {
    throw new Error(
      `Could not resolve DCA licType codes for: ${missing.join(', ')}. (Check DCA license types response for exact names.)`,
    )
  }

  cachedTypeMap = map
  cachedTypeMapExp = now + 6 * 60 * 60 * 1000 // 6h
  return map
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as Partial<VerifyReq>

    if (body.state !== 'CA') {
      return NextResponse.json({ ok: false, error: 'Only CA is supported right now.' }, { status: 400 })
    }

    const profession = String(body.profession ?? '')
    const licenseNumber = String(body.licenseNumber ?? '').trim().toUpperCase()

    if (!licenseNumber || licenseNumber.length < 4) {
      return NextResponse.json({ ok: false, error: 'Enter a valid license number.' }, { status: 400 })
    }

    const typeMap = await getBreezeTypeMap()
    const licType = typeMap[profession]
    if (!licType) {
      return NextResponse.json({ ok: false, error: 'Unsupported profession.' }, { status: 400 })
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

    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: data?.error || 'License lookup failed.' }, { status: res.status })
    }

    // Normalize response (schema: DetailedLicenseSearch)
    const detailsRoot = Array.isArray(data?.licenseDetails) ? data.licenseDetails : []
    const full = detailsRoot?.[0]?.getFullLicenseDetail?.[0] ?? null
    const lic = full?.getLicenseDetails?.[0] ?? null
    const nameBlock = full?.getNameDetails?.[0]?.individualNameDetails?.[0] ?? null

    const verified =
      Boolean(lic?.licNumber) &&
      String(lic?.licNumber).toUpperCase() === licenseNumber &&
      String(lic?.primaryStatusCode ?? '').toUpperCase().includes('CURRENT')

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
            firstName: nameBlock?.firstName ?? null,
            lastName: nameBlock?.lastName ?? null,
          }
        : null,
      raw: data, // for audit/demo; later store a snapshot server-side
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Verification error.' }, { status: 500 })
  }
}
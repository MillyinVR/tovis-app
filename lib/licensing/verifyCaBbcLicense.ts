// lib/licensing/verifyCaBbcLicense.ts
//
// CA DCA (BreEZe) online licence verification — the only auto-verifier today.
//
// Lifted verbatim out of app/api/v1/auth/register/route.ts (2026-08-23) when
// the "become a pro" upgrade door needed the same check. It was a local
// function in that route, so a second caller had no way to reach it; copying it
// would have forked the one piece of code that decides whether somebody may
// legally take bookings. Behaviour is unchanged — only its address.

import { Prisma, type ProfessionType } from '@prisma/client'

import { readOptionalEnv as envOrNull } from '@/lib/env'
import { isRecord } from '@/lib/guards'
import {
  dcaLicenseQueryNumber,
  isCurrentStatusCode,
  licenseNumbersMatch,
  parseDcaLicenseRecord,
} from '@/lib/licensing/caDcaLicense'

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/* =========================================================
   CA DCA (BreEZe) verification
========================================================= */

export type CaVerifyResult =
  | {
      ok: true
      verified: true
      statusCode: string | null
      expDate: string | null
      raw: Prisma.InputJsonValue
      source: 'CA_DCA_BREEZE'
    }
  | {
      ok: true
      verified: false
      statusCode: string | null
      expDate: string | null
      raw: Prisma.InputJsonValue
      source: 'CA_DCA_BREEZE'
    }
  | {
      ok: false
      error: string
      reason:
        | 'TIMEOUT'
        | 'UNAVAILABLE'
        | 'CONFIG'
        | 'UNKNOWN'
        // A 200 we could not read as a license record (empty body, a 200-shaped
        // gateway error page, schema drift). Not evidence — degrade, never reject.
        | 'UNREADABLE'
        // A record came back CURRENT under a different number. Ambiguous, so a
        // human compares the two rather than the signup being refused.
        | 'NUMBER_MISMATCH'
      /** Extra context persisted for whoever picks up the manual review. */
      details?: Prisma.JsonObject
    }

let cachedTypeMap: Record<string, string> | null = null
let cachedTypeExp = 0

async function getCaDcaTypeMap(): Promise<Record<string, string>> {
  const now = Date.now()
  if (cachedTypeMap && now < cachedTypeExp) return cachedTypeMap

  const APP_ID = envOrNull('DCA_SEARCH_APP_ID')
  const APP_KEY = envOrNull('DCA_SEARCH_APP_KEY')
  if (!APP_ID || !APP_KEY) {
    throw new Error(
      'DCA API is not configured (missing DCA_SEARCH_APP_ID / DCA_SEARCH_APP_KEY).',
    )
  }

  const url =
    'https://iservices.dca.ca.gov/api/v1/search/v1/breezeDetailService/getAllLicenseTypes'
  const res = await fetch(url, {
    headers: { APP_ID, APP_KEY },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  const data: unknown = await res.json().catch(() => ({}))

  if (!res.ok) {
    const msg =
      isRecord(data) &&
      (typeof data.message === 'string' || typeof data.error === 'string')
        ? String(data.message ?? data.error)
        : 'DCA license types lookup failed.'
    throw new Error(msg)
  }

  const rows = isRecord(data) ? asArray(data.getAllLicenseTypes) : []
  const allTypes: unknown[] = rows.flatMap((r) => {
    if (!isRecord(r)) return []
    return asArray(r.licenseTypes)
  })

  const pick = (needle: string) => {
    const need = needle.toUpperCase()
    const hit = allTypes.find((t) => {
      if (!isRecord(t)) return false
      const long = String(t.licenseLongName ?? '').toUpperCase()
      const pub = String(t.publicNameDesc ?? '').toUpperCase()
      return long.includes(need) || pub.includes(need)
    })
    if (!hit || !isRecord(hit)) return null
    const code = hit.clientCode
    return typeof code === 'string' && code.trim() ? code.trim() : null
  }

  const map: Record<string, string> = {
    COSMETOLOGIST: pick('COSMETOLOG') ?? '',
    BARBER: pick('BARBER') ?? '',
    ESTHETICIAN: pick('ESTHETIC') ?? '',
    MANICURIST: pick('MANICUR') ?? '',
    HAIRSTYLIST: pick('HAIRSTYL') ?? '',
    ELECTROLOGIST: pick('ELECTRO') ?? '',
  }

  const missing = Object.entries(map)
    .filter(([, v]) => !v)
    .map(([k]) => k)

  if (missing.length) {
    throw new Error(
      `Could not resolve DCA licType codes for: ${missing.join(', ')}.`,
    )
  }

  cachedTypeMap = map
  cachedTypeExp = now + 6 * 60 * 60 * 1000 // 6 hours
  return map
}

export async function verifyCaBbcLicense(args: {
  professionType: ProfessionType
  licenseNumber: string
}): Promise<CaVerifyResult> {
  try {
    const APP_ID = envOrNull('DCA_SEARCH_APP_ID')
    const APP_KEY = envOrNull('DCA_SEARCH_APP_KEY')
    if (!APP_ID || !APP_KEY) {
      return {
        ok: false,
        error: 'License verification is not configured.',
        reason: 'CONFIG',
      }
    }
    const typeMap = await getCaDcaTypeMap()
    const licType = typeMap[args.professionType]
    if (!licType) {
      return {
        ok: false,
        error: 'Unsupported CA license type.',
        reason: 'UNKNOWN',
      }
    }

    const url = new URL(
      'https://iservices.dca.ca.gov/api/v1/search/v1/licenseSearchService/getLicenseNumberSearch',
    )
    url.searchParams.set('licType', licType)
    // BreEZe keys on the numeric portion; the letter prefix printed on the
    // physical license is not part of what it searches on.
    url.searchParams.set('licNumber', dcaLicenseQueryNumber(args.licenseNumber))

    const res = await fetch(url.toString(), {
      headers: { APP_ID, APP_KEY },
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    })
    const data: unknown = await res.json().catch(() => ({}))

    if (!res.ok) {
      const msg =
        isRecord(data) &&
        (typeof data.message === 'string' || typeof data.error === 'string')
          ? String(data.message ?? data.error)
          : 'License lookup failed.'
      return {
        ok: false,
        error: msg,
        reason: 'UNAVAILABLE',
      }
    }

    const record = parseDcaLicenseRecord(data)

    // A 200 we cannot read is NOT a finding about this license. An empty body,
    // a gateway error page served with status 200, or BreEZe changing its
    // schema all land here — and none of them says a pro is unlicensed. Send it
    // down the same manual-review path as a network failure rather than
    // refusing a legitimate signup on the strength of an unparseable response.
    if (!record) {
      return {
        ok: false,
        error: 'DCA returned no readable license record.',
        reason: 'UNREADABLE',
        details: { dcaRecordParsed: false },
      }
    }

    // Match first: a record filed under a different number tells us nothing
    // about THIS pro's license, so its status must not condemn them either.
    //
    // Note we deliberately do NOT persist the raw payload here — it is the
    // government record of a DIFFERENT licensee. The admin gets both numbers
    // and the status, which is what the comparison actually needs.
    if (!licenseNumbersMatch(record.licNumber ?? '', args.licenseNumber)) {
      return {
        ok: false,
        error: 'The license number did not match the record DCA returned.',
        reason: 'NUMBER_MISMATCH',
        details: {
          dcaRecordParsed: true,
          dcaReturnedLicenseNumber: record.licNumber,
          submittedLicenseNumber: args.licenseNumber,
          statusCode: record.statusCode,
        },
      }
    }

    // Prisma wants InputJsonValue for create/update inputs.
    // fetch().json() is JSON-safe; stringify/parse guarantees no Date/functions/undefined.
    const rawJson: Prisma.InputJsonValue = JSON.parse(
      JSON.stringify(data ?? {}),
    )

    // This pro's own record, read cleanly. Only here is `verified: false`
    // definitive — it is the one case that still hard-rejects at signup.
    return {
      ok: true,
      verified: isCurrentStatusCode(record.statusCode),
      statusCode: record.statusCode,
      expDate: record.expDate,
      raw: rawJson,
      source: 'CA_DCA_BREEZE',
    }
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') {
      return {
        ok: false,
        error: 'DCA verification timed out.',
        reason: 'TIMEOUT',
      }
    }

    const msg = e instanceof Error ? e.message : 'Verification error.'
    return {
      ok: false,
      error: msg,
      reason:
        msg.includes('not configured') || msg.includes('missing')
          ? 'CONFIG'
          : 'UNAVAILABLE',
    }
  }
}
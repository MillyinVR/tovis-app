// app/api/_utils/readJsonRecord.ts
import { isRecord, type UnknownRecord } from '@/lib/guards'

/**
 * Parse a request's JSON body into a plain record. Returns an empty record when
 * the body is missing, malformed, or not a JSON object. Single source of truth
 * for the `await req.json().catch(() => ({}))` + `isRecord(raw) ? raw : {}` idiom.
 *
 * NOTE: imported from this specific path (not the `@/app/api/_utils` barrel) so
 * route tests that partially-mock the barrel don't accidentally stub it out.
 */
export async function readJsonRecord(req: Request): Promise<UnknownRecord> {
  const raw: unknown = await req.json().catch(() => ({}))
  return isRecord(raw) ? raw : {}
}

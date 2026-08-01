// app/api/v1/pro/clients/[id]/consent/route.ts
//
// Consent / waiver + patch-test records (PR4 — flagged, legal-gated). Author-
// scoped; the patch-test result + validity are SAFETY fields that travel to any
// pro with access (read side enforces scope), while the signed artifact stays
// with its author. 404s when the flag is off.
import { prisma } from '@/lib/prisma'
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import {
  resolveRouteParams,
  type RouteContext,
} from '@/app/api/_utils/routeContext'
import { assertProCanViewClient } from '@/lib/clientVisibility'
import { chartRefusal } from '@/lib/clients/chartAccessCopy'
import { readJsonRecord } from '@/app/api/_utils/readJsonRecord'
import {
  ClientConsentKind,
  ClientNoteVisibility,
  ConsentProofMethod,
  PatchTestResult,
} from '@prisma/client'
import { encryptedNoteInput } from '@/lib/security/notesPrivacy'
import { isClientTechnicalRecordEnabled } from '@/lib/clients/technicalRecord'

export const dynamic = 'force-dynamic'

const SCOPE_MAX = 200
const NOTES_MAX = 4000
const REF_MAX = 200

function asEnum<T extends Record<string, string>>(
  enumObj: T,
  value: unknown,
): T[keyof T] | null {
  const v = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return (Object.values(enumObj) as string[]).includes(v)
    ? (v as T[keyof T])
    : null
}

function parseDate(value: unknown): Date | null {
  const s = pickString(value)
  if (!s) return null
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

export async function POST(req: Request, context: RouteContext) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const professionalId = auth.professionalId

    if (!isClientTechnicalRecordEnabled(professionalId))
      return jsonFail(404, 'Not found.')

    const params = await resolveRouteParams(context)
    const clientId = pickString(params.id)
    if (!clientId) return jsonFail(400, 'Missing client id.')

    const gate = await assertProCanViewClient(professionalId, clientId)
    if (!gate.ok) {
      const refusal = chartRefusal(gate.visibility, 403)
      return jsonFail(refusal.status, refusal.message, { code: refusal.code })
    }

    const body = await readJsonRecord(req)

    const kind = asEnum(ClientConsentKind, body.kind)
    if (!kind) return jsonFail(400, 'A valid consent kind is required.')

    const serviceScope = pickString(body.serviceScope)?.slice(0, SCOPE_MAX) ?? null
    const proofMethod = asEnum(ConsentProofMethod, body.proofMethod)

    // 🔴 K15 (closing K14-B). CLIENT_TOKEN means "the platform witnessed this
    // signature through a link it sent", and from K15 the only writer of it is
    // the signing route behind /client/consent/<token> — which also stamps
    // `signatureTokenId`, the UNIQUE column that proves a real link existed.
    // Accepting a hand-typed claim here would put the same proof method on a
    // record with no link behind it, which is exactly the lie K14 found this
    // control telling. Refused, not hidden: dropping it from the dropdown alone
    // would leave the claim one curl away.
    if (proofMethod === ConsentProofMethod.CLIENT_TOKEN) {
      return jsonFail(
        400,
        'Send the form to the client to record a link signature.',
      )
    }
    const proofRef = pickString(body.proofRef)?.slice(0, REF_MAX) ?? null
    const signedAt = parseDate(body.signedAt)
    const notes = pickString(body.notes)?.slice(0, NOTES_MAX) ?? null

    // Patch-test specifics only meaningful for PATCH_TEST.
    const patchTestResult =
      kind === ClientConsentKind.PATCH_TEST
        ? asEnum(PatchTestResult, body.patchTestResult)
        : null
    const validUntil =
      kind === ClientConsentKind.PATCH_TEST ? parseDate(body.validUntil) : null

    // K14 — pin the record to the exact form text put in front of the client.
    // Optional: a pro recording a paper waiver they hold has nothing to point at,
    // and that record must still be writable.
    const formVersionId = pickString(body.formVersionId)
    if (formVersionId) {
      const version = await prisma.consentFormVersion.findFirst({
        // Own forms only. A platform template is readable by everyone, but
        // attaching one the pro never adopted would attribute the platform's
        // text to a record in their name.
        // No isActive check on purpose: the picker only OFFERS active forms,
        // but recording a signature a client really gave against a form since
        // retired is a truthful record, and refusing it would lose history.
        where: { id: formVersionId, form: { professionalId } },
        select: { id: true, form: { select: { kind: true } } },
      })
      if (!version) return jsonFail(400, 'Form version not found.')
      if (version.form.kind !== kind) {
        // A record labelled PATCH_TEST pointing at a colour-waiver's words is
        // worse than no form at all: it reads as proof of something it isn't.
        return jsonFail(400, 'That form is for a different kind of consent.')
      }
    }

    const bookingId = pickString(body.bookingId)
    if (bookingId) {
      const booking = await prisma.booking.findFirst({
        where: { id: bookingId, clientId },
        select: { id: true },
      })
      if (!booking) return jsonFail(400, 'Booking does not belong to this client.')
    }

    const created = await prisma.clientConsentRecord.create({
      data: {
        clientId,
        professionalId,
        bookingId: bookingId || null,
        kind,
        serviceScope,
        formVersionId: formVersionId || null,
        signedAt,
        proofMethod,
        proofRef,
        patchTestResult,
        validUntil,
        notesEncrypted: encryptedNoteInput(notes),
        visibility: ClientNoteVisibility.PRIVATE_TO_AUTHOR,
      },
      select: { id: true },
    })

    return jsonOk({ id: created.id }, 201)
  } catch (e) {
    console.error('POST /api/v1/pro/clients/[id]/consent error', e)
    return jsonFail(500, 'Failed to save consent record.')
  }
}

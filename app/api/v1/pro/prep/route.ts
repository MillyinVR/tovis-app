// app/api/v1/pro/prep/route.ts
//
// The pro authoring their "Before you go" checklist and the note beside it.
//
// TWO SCOPES, one endpoint, selected by `?offeringId=`:
//   · absent — the pro's DEFAULT list and default note.
//   · present — that service's own list and note, which REPLACE the default
//     for bookings of that service (see lib/booking/prep.ts).
//
// PUT replaces the whole scope in one transaction rather than exposing per-row
// CRUD. That matches how the editor actually works (edit the list, save it) and
// it means "delete the last row" is expressible — a per-row DELETE plus an
// empty-list PUT would be two ways to say the same thing.
//
// 🔴 Rows are re-created on every save, so their ids change. `BookingPrepCheck`
// cascades from `ProPrepItem`, so a client's ticks against a row the pro
// rewrites are dropped with it. That is the honest behaviour: the row they
// ticked no longer exists. Rows whose text is UNCHANGED keep their id, so an
// edit to row 3 does not silently clear a client's tick on rows 1 and 2.
import { jsonFail, jsonOk, pickString, requirePro } from '@/app/api/_utils'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** A checklist a client has to scroll is not a checklist. */
const MAX_ITEMS = 12
const MAX_ITEM_LENGTH = 200
const MAX_NOTE_LENGTH = 1000

type Body = { items?: unknown; note?: unknown }

function normalizeItems(raw: unknown): string[] | { error: string } {
  if (!Array.isArray(raw)) return { error: 'items must be an array.' }
  if (raw.length > MAX_ITEMS) {
    return { error: `A checklist can hold at most ${MAX_ITEMS} rows.` }
  }

  const items: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') return { error: 'Every row must be text.' }
    const trimmed = entry.trim()
    // A blank row is a row the pro deleted the text of, not an error — drop it
    // rather than refusing the whole save and losing their other edits.
    if (trimmed.length === 0) continue
    if (trimmed.length > MAX_ITEM_LENGTH) {
      return { error: `A row can be at most ${MAX_ITEM_LENGTH} characters.` }
    }
    items.push(trimmed)
  }
  return items
}

export async function GET(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const { professionalId } = auth

    const offeringId = pickString(new URL(req.url).searchParams.get('offeringId'))
    if (offeringId) {
      const owned = await prisma.professionalServiceOffering.findFirst({
        where: { id: offeringId, professionalId },
        select: { id: true },
      })
      if (!owned) return jsonFail(404, 'Service not found.')
    }

    const [items, professional, offering] = await Promise.all([
      prisma.proPrepItem.findMany({
        where: { professionalId, offeringId: offeringId ?? null, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, text: true, sortOrder: true },
      }),
      prisma.professionalProfile.findUnique({
        where: { id: professionalId },
        select: { prepNote: true },
      }),
      offeringId
        ? prisma.professionalServiceOffering.findUnique({
            where: { id: offeringId },
            select: { prepNote: true },
          })
        : Promise.resolve(null),
    ])

    return jsonOk({
      ok: true,
      scope: offeringId ? 'OFFERING' : 'PROFESSIONAL',
      items,
      note: (offeringId ? offering?.prepNote : professional?.prepNote) ?? null,
      /** What a booking of this service falls back to when the list is empty. */
      defaultNote: professional?.prepNote ?? null,
    })
  } catch (err) {
    console.error('[pro prep GET]', safeError(err))
    return jsonFail(500, 'Could not load your checklist.')
  }
}

export async function PUT(req: Request) {
  try {
    const auth = await requirePro()
    if (!auth.ok) return auth.res
    const { professionalId } = auth

    const offeringId = pickString(new URL(req.url).searchParams.get('offeringId'))
    if (offeringId) {
      const owned = await prisma.professionalServiceOffering.findFirst({
        where: { id: offeringId, professionalId },
        select: { id: true },
      })
      if (!owned) return jsonFail(404, 'Service not found.')
    }

    const body = (await req.json().catch(() => ({}))) as Body
    const items = normalizeItems(body?.items)
    if (!Array.isArray(items)) return jsonFail(400, items.error)

    let note: string | null = null
    if (body?.note != null) {
      if (typeof body.note !== 'string') {
        return jsonFail(400, 'note must be text.')
      }
      const trimmed = body.note.trim()
      if (trimmed.length > MAX_NOTE_LENGTH) {
        return jsonFail(400, `A note can be at most ${MAX_NOTE_LENGTH} characters.`)
      }
      note = trimmed.length > 0 ? trimmed : null
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.proPrepItem.findMany({
        where: { professionalId, offeringId: offeringId ?? null },
        select: { id: true, text: true },
      })

      // Keep the row a client may already have ticked whenever its text is
      // unchanged — matching by text, because that is the only thing the pro
      // sees and therefore the only identity the row really has to them.
      const byText = new Map<string, string>()
      for (const row of existing) {
        if (!byText.has(row.text)) byText.set(row.text, row.id)
      }

      const keptIds: string[] = []
      for (const [index, text] of items.entries()) {
        const existingId = byText.get(text)
        if (existingId) {
          byText.delete(text)
          keptIds.push(existingId)
          await tx.proPrepItem.update({
            where: { id: existingId },
            data: { sortOrder: index, isActive: true },
          })
        } else {
          const created = await tx.proPrepItem.create({
            data: {
              professionalId,
              offeringId: offeringId ?? null,
              text,
              sortOrder: index,
            },
            select: { id: true },
          })
          keptIds.push(created.id)
        }
      }

      // Anything the pro removed. Cascades its clients' ticks, which is right:
      // the row they ticked is gone.
      await tx.proPrepItem.deleteMany({
        where: {
          professionalId,
          offeringId: offeringId ?? null,
          id: { notIn: keptIds.length > 0 ? keptIds : ['__none__'] },
        },
      })

      if (body?.note !== undefined) {
        if (offeringId) {
          await tx.professionalServiceOffering.update({
            where: { id: offeringId },
            data: { prepNote: note },
          })
        } else {
          await tx.professionalProfile.update({
            where: { id: professionalId },
            data: { prepNote: note },
          })
        }
      }
    })

    const saved = await prisma.proPrepItem.findMany({
      where: { professionalId, offeringId: offeringId ?? null, isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, text: true, sortOrder: true },
    })

    return jsonOk({ ok: true, items: saved, note })
  } catch (err) {
    console.error('[pro prep PUT]', safeError(err))
    return jsonFail(500, 'Could not save your checklist.')
  }
}

// lib/consult/lookBookEntry.client.ts
//
// Book the Look, B4b — what a look's Book button does.
//
// ONE implementation, shared by the feed and the look detail page, because the
// two rendered the same button and would otherwise grow two answers to the same
// question ([[a-fork-under-a-new-name-bypasses-its-callers-controls]]).
//
// The decision is the SERVER's: `GET /api/v1/client/consult/look/availability`
// already applies the founder gate, look visibility and the pilot vertical, and
// answers `available: false` with no reason when the pilot is dark for that pro
// — indistinguishable from a client who simply has no consult. So this asks,
// and does not re-derive any part of it client-side.
//
// It is asked ON TAP rather than on render. A probe per feed slide would put two
// database reads in front of every scroll for every viewer, pilot or not, on the
// hottest surface in the app; asking once, when someone actually taps Book,
// costs nothing at rest and leaves the button pixel-identical for everyone.
//
// Anything other than a clear "yes" — a guest, a network failure, a non-pilot
// pro, a look with no service linkage — returns `null`, and the caller opens
// today's availability drawer unchanged.

import { isRecord } from '@/lib/guards'

/** Where a Book tap should go, when the look-consult pilot is open for it. */
export type LookConsultEntryDestination = { href: string }

type ConsultShape = { id: string; status: string }

function readConsult(value: unknown): ConsultShape | null {
  if (!isRecord(value)) return null
  const id = typeof value.id === 'string' ? value.id.trim() : ''
  const status = typeof value.status === 'string' ? value.status : ''
  return id ? { id, status } : null
}

/**
 * A consult that already reached results goes straight to its booking door; one
 * still mid-flow resumes where it was. `/client/consult/[id]` itself forwards a
 * COMPLETED session to its results, so this is about landing on the RIGHT page
 * for a Book tap, not about guarding the flow.
 *
 * 🔴 CANCELLED returns null, and that is the whole point of this function
 * returning an optional. The server hands back the existing session for a
 * (client, pro, look) triple whatever its status — a unique index makes a second
 * one impossible — so a terminal consult used to capture the Book button
 * forever: every tap landed on a screen with no forward action, and the ordinary
 * booking drawer below was never reached. A consult that cannot be revived must
 * give the button BACK rather than hold it.
 *
 * CONSENT_REVOKED is NOT terminal and deliberately still resumes: accepting a
 * fresh agreement transitions it CONSENT_REVOKED → CONSENT_REQUIRED
 * (lib/consult/writeBoundary.ts), so the flow's own consent step is the way
 * back in. The flow must render that step for a revoked session — see
 * ClientConsultFlow.
 */
function destinationForConsult(
  consult: ConsultShape,
): LookConsultEntryDestination | null {
  // Terminal with no recovery transition: purged mid-analysis. Nothing the
  // client can do revives it, so the tap falls through to ordinary booking.
  if (consult.status === 'CANCELLED') return null

  const id = encodeURIComponent(consult.id)
  return {
    href:
      consult.status === 'COMPLETED'
        ? `/client/consult/${id}/book`
        : `/client/consult/${id}`,
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json()
  } catch {
    return null
  }
}

/**
 * Ask whether this look opens a consult for this viewer, and start (or resume)
 * one if it does.
 *
 * Returns the destination to navigate to, or `null` meaning "not this look, not
 * this viewer" — for which the caller keeps its existing behaviour exactly.
 */
export async function resolveLookConsultEntry(
  lookPostId: string,
  options?: { signal?: AbortSignal },
): Promise<LookConsultEntryDestination | null> {
  const id = lookPostId.trim()
  if (!id) return null

  let availability: Response
  try {
    availability = await fetch(
      `/api/v1/client/consult/look/availability?lookPostId=${encodeURIComponent(id)}`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        signal: options?.signal,
      },
    )
  } catch {
    return null
  }

  if (!availability.ok) return null

  // `jsonOk` emits a FLAT envelope — `{ ok: true, availability: {...} }` — with
  // no `data` wrapper (app/api/_utils/responses.ts).
  const body = await readJson(availability)
  const record = isRecord(body) ? body.availability : null

  if (!isRecord(record) || record.available !== true) return null

  const existing = readConsult(record.consult)
  if (existing) return destinationForConsult(existing)

  // Create-or-resume on the server: tapping Book twice returns the same consult
  // rather than a second one (the unique index is what makes that true under a
  // race), so a retry here is safe.
  let started: Response
  try {
    started = await fetch('/api/v1/client/consult/look', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ lookPostId: id }),
      signal: options?.signal,
    })
  } catch {
    return null
  }

  if (!started.ok) return null

  const startedBody = await readJson(started)
  const consult = isRecord(startedBody)
    ? readConsult(startedBody.consult)
    : null

  return consult ? destinationForConsult(consult) : null
}

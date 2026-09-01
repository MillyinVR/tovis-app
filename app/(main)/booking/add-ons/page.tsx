// app/(main)/booking/add-ons/page.tsx
import { headers } from 'next/headers'
import AddOnsClient from './ui/AddOnsClient'
import { safeJsonRecord, readErrorMessage } from '@/lib/http'
import { isRecord } from '@/lib/guards'
import { prisma } from '@/lib/prisma'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'
import { getProNoShowSettings } from '@/lib/noShowProtection/settings'
import { cancellationPolicyDisclosure } from '@/lib/noShowProtection/policyDisclosure'
// Shared wire DTO for GET /api/v1/offerings/add-ons — single source of truth for
// the add-on shape (web + native). The `id` is the OfferingAddOn link id.
import type { OfferingAddOnItemDTO as AddOnDTO } from '@/lib/dto'
import { loadAddOnsContext } from '@/lib/booking/addOnsContext'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import {
  ConsultProposalEntryError,
  loadAuthorizedConsultBookingProposal,
} from '@/lib/consult/proposalEntry'
import { MAX_CONSULT_ENHANCEMENT_LINE_IDS } from '@/lib/consult/enhancementOffer'
import { getCurrentUser } from '@/lib/currentUser'
import type { ConsultBookingProposalDTO } from '@/lib/dto/consult'
import { BookingStatus, type BookingSource, type ServiceLocationType } from '@prisma/client'
import { getClientSubmittedBookingStatus } from '@/lib/booking/statusRules'
import { COPY } from '@/lib/copy'

/**
 * Book the Look, B4b — when this step carries a `consultId` it is not an add-on
 * picker at all. It is the REVIEW of a consultation's booking proposal: the same
 * hold countdown, the same cancellation-policy gate, the same card-on-file step
 * and the same finalize, with the proposal in place of the add-on list.
 *
 * It reuses this route rather than growing a second confirm screen because that
 * screen would be a copy of `AddOnsClient`'s finalize path — and the copy is
 * where the two would drift.
 *
 * B7 (decision 10) makes it a picker again, of a different kind. The pro's
 * `OfferingAddOn` catalog is still refused here — the hold route and the write
 * boundary both say why — but the ANALYSIS's own beyond-floor recommendations
 * are offered as enhancements the client opts into. They ride the URL as
 * `enhancementIds`, and this server component re-derives the whole proposal for
 * that set on every toggle: the price, the length and each "+$40" come back
 * from the same function the finalize runs, so no total is ever assembled in
 * the browser.
 */
async function loadConsultProposalForReview(args: {
  consultId: string
  holdId: string | null
  enhancementLineIds: string[]
}): Promise<ConsultBookingProposalDTO | null> {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) return null
  if (!args.holdId) return null

  // 🔴 The mode comes from the HOLD, never from the query string.
  // `finalizeBookingFromHold` re-derives this proposal under
  // `validatedHold.value.locationType`, so a `?locationType=` a client edits in
  // the address bar would change only what this page SHOWS — a salon estimate
  // printed over a mobile commit. Reading the reservation makes the preview and
  // the commit read the same field. Scoped to a hold this client owns, so the
  // lookup cannot be used to read anyone else's reservation.
  const hold = await prisma.bookingHold.findFirst({
    where: { id: args.holdId, clientId: user.clientProfile.id },
    select: { locationType: true },
  })
  if (!hold) return null

  try {
    const answer = await loadAuthorizedConsultBookingProposal({
      consultSessionId: args.consultId,
      clientId: user.clientProfile.id,
      actorUserId: user.id,
      locationType: hold.locationType,
      // 🔴 B7: exactly what the URL claims, and the URL only ever carries what
      // this page put there. An id that is not one of this estimate's lines is
      // ignored by the derivation, so a hand-edited link can only ever book
      // LESS than the hold reserved — never more, and never at a price the
      // server did not derive.
      enhancementSelection: args.enhancementLineIds,
    })
    return answer.proposal
  } catch (error: unknown) {
    // Not yours, not found, or the pilot went dark between the hold and here.
    // Answered as "no proposal", which the client sees as an explained refusal
    // rather than as a page that throws.
    if (error instanceof ConsultProposalEntryError) return null
    throw error
  }
}

export const dynamic = 'force-dynamic'

/** Client-side sources only — `IMPORTED` is written by calendar migration. */
type ClientBookingSource = Exclude<BookingSource, 'IMPORTED'>

type AddOnsApiOk = {
  ok: true
  addOns?: AddOnDTO[]
  offeringId?: string
  locationType?: ServiceLocationType
  selectionPrompt?: string | null
}

type AddOnsApiFail = {
  ok: false
  error: string
}

type AddOnsApiResponse = AddOnsApiOk | AddOnsApiFail
type AddOnsDTOResult =
  | { ok: true; addOns: AddOnDTO[]; selectionPrompt: string | null }
  | { ok: false; error: string }

function pickOne(v: string | string[] | undefined | null) {
  if (!v) return null
  return Array.isArray(v) ? (v[0] ?? null) : v
}

function cleanString(v: string | null) {
  const s = (v || '').trim()
  return s ? s : null
}

function normalizeLocationType(v: string | null): ServiceLocationType {
  const s = (v || '').trim().toUpperCase()
  return s === 'MOBILE' ? 'MOBILE' : 'SALON'
}

function normalizeSource(v: string | null): ClientBookingSource {
  const s = (v || '').trim().toUpperCase()
  if (s === 'DISCOVERY') return 'DISCOVERY'
  if (s === 'AFTERCARE') return 'AFTERCARE'
  return 'REQUESTED'
}

function parseCommaIds(raw: string | null, max: number): string[] {
  if (!raw) return []
  const out: string[] = []
  const seen = new Set<string>()

  for (const part of raw.split(',')) {
    const s = part.trim()
    if (!s) continue
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= max) break
  }

  return out
}

async function getRequestOrigin() {
  const h = await headers()
  const host = h.get('x-forwarded-host') ?? h.get('host')
  const proto = h.get('x-forwarded-proto') ?? 'http'
  if (!host) return null
  return `${proto}://${host}`
}

function coerceAddOn(x: unknown): AddOnDTO | null {
  if (!isRecord(x)) return null

  const id = typeof x.id === 'string' ? x.id.trim() : ''
  const serviceId = typeof x.serviceId === 'string' ? x.serviceId.trim() : ''
  const title = typeof x.title === 'string' ? x.title.trim() : ''
  const price = typeof x.price === 'string' ? x.price.trim() : ''
  const minutes = typeof x.minutes === 'number' ? x.minutes : null
  const sortOrder = typeof x.sortOrder === 'number' ? x.sortOrder : null
  const isRecommended = typeof x.isRecommended === 'boolean' ? x.isRecommended : false
  const isPreselected = typeof x.isPreselected === 'boolean' ? x.isPreselected : false
  const group = typeof x.group === 'string' ? x.group : x.group == null ? null : null

  if (!id || !serviceId || !title || !price) return null
  if (minutes == null || !Number.isFinite(minutes)) return null
  if (sortOrder == null || !Number.isFinite(sortOrder)) return null

  return { id, serviceId, title, group, price, minutes, sortOrder, isRecommended, isPreselected }
}

function parseAddOnsApiResponse(x: unknown): AddOnsApiResponse | null {
  if (!isRecord(x)) return null

  const ok = x.ok
  if (ok === true) {
    const addOnsRaw = x.addOns
    const addOns = Array.isArray(addOnsRaw)
      ? addOnsRaw.map(coerceAddOn).filter((a): a is AddOnDTO => a !== null)
      : undefined

    const offeringId = typeof x.offeringId === 'string' ? x.offeringId : undefined
    const locationType = x.locationType === 'MOBILE' || x.locationType === 'SALON' ? x.locationType : undefined
    const selectionPrompt =
      typeof x.selectionPrompt === 'string'
        ? x.selectionPrompt.trim() || null
        : null

    return { ok: true, offeringId, locationType, addOns, selectionPrompt }
  }

  if (ok === false) {
    const error = typeof x.error === 'string' ? x.error.trim() : ''
    if (!error) return null
    return { ok: false, error }
  }

  return null
}

async function fetchAddOns(args: { offeringId: string; locationType: ServiceLocationType }): Promise<AddOnsDTOResult> {
  const qs = new URLSearchParams({ offeringId: args.offeringId, locationType: args.locationType })

  const origin = await getRequestOrigin()
  const url = origin ? `${origin}/api/v1/offerings/add-ons?${qs.toString()}` : `/api/v1/offerings/add-ons?${qs.toString()}`

  const h = await headers()
  const cookie = h.get('cookie') ?? ''

  let res: Response
  try {
    res = await fetch(url, {
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(cookie ? { cookie } : {}),
      },
    })
  } catch (err: unknown) {
    console.error('fetchAddOns network error:', err)
    return { ok: false, error: 'Network error loading add-ons.' }
  }

  const body = await safeJsonRecord(res)
  const parsed = parseAddOnsApiResponse(body)

  if (!res.ok) {
    if (parsed && parsed.ok === false) return { ok: false, error: parsed.error }
    return { ok: false, error: readErrorMessage(body) ?? `Failed to load add-ons (${res.status}).` }
  }

  if (!parsed || parsed.ok !== true) {
    return { ok: false, error: readErrorMessage(body) ?? 'Failed to load add-ons.' }
  }

  return {
    ok: true,
    addOns: parsed.addOns ?? [],
    selectionPrompt: parsed.selectionPrompt ?? null,
  }
}

export default async function BookingAddOnsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams

  const holdId = cleanString(pickOne(sp.holdId) ?? null)
  const offeringId = cleanString(pickOne(sp.offeringId) ?? null)
  const locationType = normalizeLocationType(cleanString(pickOne(sp.locationType) ?? null))
  const source = normalizeSource(cleanString(pickOne(sp.source) ?? null))
  const mediaId = cleanString(pickOne(sp.mediaId) ?? null)
  const lookPostId = cleanString(pickOne(sp.lookPostId) ?? null)
  const consultId = cleanString(pickOne(sp.consultId) ?? null)
  // Book the Look, B7 — the enhancements she has ticked so far. Comma-separated
  // like every other id list in this codebase's query strings, capped the same
  // way the finalize caps them.
  const enhancementLineIds = parseCommaIds(
    cleanString(pickOne(sp.enhancementIds) ?? null),
    MAX_CONSULT_ENHANCEMENT_LINE_IDS,
  )

  // The look/pro/time/hold the sheet already knew — see lib/booking/addOnsContext.
  const addOnsContext = await loadAddOnsContext({ holdId, mediaId })

  const urlAddOnIdsRaw = cleanString(pickOne(sp.addOnIds) ?? null)
  const urlAddOnIds = parseCommaIds(urlAddOnIdsRaw, 50)

  let addOns: AddOnDTO[] = []
  let selectionPrompt: string | null = null
  let initialError: string | null = null
  let consultProposal: ConsultBookingProposalDTO | null = null

  if (!offeringId) {
    initialError = 'Missing offering. Please go back and pick a time again.'
  } else if (consultId) {
    // A consultation booking reviews its PROPOSAL, never add-ons — so the
    // add-on fetch is not merely hidden, it never happens.
    consultProposal = await loadConsultProposalForReview({
      consultId,
      holdId,
      enhancementLineIds,
    })

    if (!consultProposal) {
      initialError =
        'This look isn’t bookable right now. Message your professional and she can book it for you.'
    } else if (consultProposal.locationType !== locationType) {
      // The URL's mode and the reservation's disagree. The commit would follow
      // the HOLD, so rather than render one mode's numbers over another mode's
      // booking, send her back to pick a time.
      consultProposal = null
      initialError =
        'That time was held for a different option. Please pick a time again.'
    } else if (consultProposal.offeringId !== offeringId) {
      // The floor moved between the hold and here. The finalize would refuse
      // this pair anyway (CONSULT_PROPOSAL_OFFERING_MISMATCH); saying so now
      // beats a refusal at the end of checkout.
      consultProposal = null
      initialError =
        'This consultation no longer matches that time. Please pick a time again.'
    }
  } else {
    const res = await fetchAddOns({ offeringId, locationType })
    if (!res.ok) initialError = res.error
    else {
      addOns = res.addOns
      selectionPrompt = res.selectionPrompt
    }
  }

  // The pro this booking is for. Read once and used twice below — the no-show
  // policy gate and the commit sentence both need her, and two lookups of the
  // same row is how the two answers drift apart.
  const offeringProfessional = offeringId
    ? await prisma.professionalServiceOffering.findUnique({
        where: { id: offeringId },
        select: { professionalId: true, professional: { select: { autoAcceptBookings: true } } },
      })
    : null

  // The pro's no-show / late-cancel fee policy the client must agree to before
  // booking (M15). Non-null only when the pro charges fees and the flag is on;
  // when present, AddOnsClient shows it + requires the agreement checkbox.
  let cancellationPolicy: string | null = null
  if (offeringProfessional && noShowProtectionEnabled()) {
    cancellationPolicy = cancellationPolicyDisclosure(
      await getProNoShowSettings(offeringProfessional.professionalId),
    )
  }

  // 🔴 The ORDINARY booking's commit sentence, and the whole reason it is
  // composed here rather than hardcoded in the component: this screen printed
  // "No charge until the pro confirms" to everyone, including clients of a pro
  // whose `autoAcceptBookings` is ON — for whom there is no confirmation and
  // the sentence describes a step that never happens. (Carried from B4b, where
  // the CONSULT branch was given a server-composed `commitNote` for exactly
  // this reason and the non-consult branch was left as it was.)
  //
  // Routed through the same `getClientSubmittedBookingStatus` fork the commit
  // runs, so the promise on this screen cannot disagree with the booking that
  // follows. Null when there is no offering to read a pro from, which the
  // component renders as no sentence rather than as a guess.
  const commitNote = offeringProfessional
    ? getClientSubmittedBookingStatus(
        offeringProfessional.professional.autoAcceptBookings,
      ) === BookingStatus.ACCEPTED
      ? COPY.bookingCommit.instant
      : COPY.bookingCommit.request
    : null

  // ✅ server-hydrate initial selection (prevents client flicker)
  const initialSelectedIds = (() => {
    if (!addOns.length) return []

    const allowed = new Set(addOns.map((a) => a.id))
    const filteredFromUrl = urlAddOnIds.filter((id) => allowed.has(id))

    if (filteredFromUrl.length) return filteredFromUrl

    // If URL has nothing valid, fall back to the pro's own pre-select opt-in
    // — independent of isRecommended, which only drives the badge (Tori,
    // 2026-08-14).
    const preselected = addOns.filter((a) => a.isPreselected).map((a) => a.id)
    return preselected
  })()

  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())

  return (
    <AddOnsClient
      context={addOnsContext}
      holdId={holdId}
      offeringId={offeringId}
      locationType={locationType}
      source={source}
      mediaId={mediaId}
      lookPostId={lookPostId}
      consultId={consultId}
      consultProposal={consultProposal}
      consultCopy={brand.clientConsultBooking}
      addOns={addOns}
      selectionPrompt={selectionPrompt}
      initialError={initialError}
      initialSelectedIds={initialSelectedIds}
      cancellationPolicy={cancellationPolicy}
      commitNote={commitNote}
      enhancementLineIds={enhancementLineIds}
    />
  )
}

// lib/proPractice/index.ts
//
// Shared pieces of the pro PRACTICE library — the shots taken with the
// standalone camera (the pro footer's centre button when no session is live).
//
// The four routes under app/api/v1/pro/practice/ all need the same three things:
// the kill-switch gate, an owner-scoped load, and one shot → DTO mapping. They
// live here so no route re-states them (and so the "not yours" answer is one
// sentence written once).

import type { Prisma, PracticeShot } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import type { ProPracticeShotDTO } from '@/lib/dto/proPractice'
import { renderMediaUrls, renderMediaUrlsBatch } from '@/lib/media/renderUrls'
import { isRuntimeFlagEnabled } from '@/lib/runtimeFlags'

/** Caption cap — same as the booking-media and portfolio routes. */
export const PRACTICE_CAPTION_MAX = 300

/** How many shots the library returns in one page (newest first). */
export const PRACTICE_LIST_LIMIT = 200

/**
 * The kill switch. `pro_practice_disabled` defaults OFF (feature on): this is a
 * new, additive, pro-only surface with no existing caller, so it ships live and
 * can be revoked instantly if the native build misbehaves in the field.
 */
export async function isProPracticeDisabled(): Promise<boolean> {
  return isRuntimeFlagEnabled('pro_practice_disabled')
}

export const PRACTICE_DISABLED_MESSAGE =
  'The practice camera is temporarily unavailable.'

/** Columns every practice route reads. */
export const PRACTICE_SHOT_SELECT = {
  id: true,
  professionalId: true,
  storageBucket: true,
  storagePath: true,
  contentType: true,
  mediaType: true,
  caption: true,
  focalX: true,
  focalY: true,
  attachedMediaId: true,
  attachedAt: true,
  createdAt: true,
} satisfies Prisma.PracticeShotSelect

export type PracticeShotRow = Pick<
  PracticeShot,
  keyof typeof PRACTICE_SHOT_SELECT & keyof PracticeShot
>

/**
 * Loads one shot and asserts the caller owns it. Returns a discriminated result
 * rather than throwing, so routes can answer with their own `jsonFail`.
 *
 * A shot belonging to another pro answers 404, not 403 — the id space is opaque
 * and "this exists but isn't yours" is more than a caller needs to know.
 */
export async function loadOwnedPracticeShot(
  shotId: string,
  professionalId: string,
): Promise<
  { ok: true; shot: PracticeShotRow } | { ok: false; status: number; error: string }
> {
  const shot = await prisma.practiceShot.findUnique({
    where: { id: shotId },
    select: PRACTICE_SHOT_SELECT,
  })

  if (!shot || shot.professionalId !== professionalId) {
    return { ok: false, status: 404, error: 'Practice shot not found.' }
  }

  return { ok: true, shot }
}

/**
 * Maps one row to the wire shape, resolving the short-lived signed render URL.
 * Storage pointers never cross the wire (same rule as every other media DTO).
 */
export async function toPracticeShotDTO(
  shot: PracticeShotRow,
): Promise<ProPracticeShotDTO> {
  const rendered = await renderMediaUrls({
    storageBucket: shot.storageBucket,
    storagePath: shot.storagePath,
  })

  return buildPracticeShotDTO(shot, rendered.renderUrl)
}

/** Batched counterpart for the list route (one signing round-trip per bucket). */
export async function toPracticeShotDTOs(
  shots: readonly PracticeShotRow[],
): Promise<ProPracticeShotDTO[]> {
  const rendered = await renderMediaUrlsBatch(
    shots.map((shot) => ({
      storageBucket: shot.storageBucket,
      storagePath: shot.storagePath,
    })),
  )

  return shots.map((shot, index) =>
    buildPracticeShotDTO(shot, rendered[index]?.renderUrl ?? null),
  )
}

function buildPracticeShotDTO(
  shot: PracticeShotRow,
  renderUrl: string | null,
): ProPracticeShotDTO {
  return {
    id: shot.id,
    mediaType: shot.mediaType,
    caption: shot.caption,
    createdAt: shot.createdAt.toISOString(),
    focalX: shot.focalX,
    focalY: shot.focalY,
    attachedMediaId: shot.attachedMediaId,
    attachedAt: shot.attachedAt ? shot.attachedAt.toISOString() : null,
    renderUrl,
  }
}

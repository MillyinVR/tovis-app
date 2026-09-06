// lib/consult/capture/earlyPhoto.ts
//
// P7a-1 — the early photo: "what do you have right now?"
//
// One photo of the client, taken or picked at the spark, before any intake.
// Its job is to unlock the booking, not to be the colour evidence — so it runs
// the same durable queue and the same vision gate as every other consult photo,
// with `gate: 'WARN_ONLY'` (lib/consult/capture/types.ts).
//
// 🔴 WHY IT IS NOT A MEMBER OF ANY PACK'S `shots` ARRAY.
//
// The obvious build is to append it to each pack. That would have put it in the
// guided checklist the client works through in prep — it is `pack.shots` that
// becomes both `shotPack.shots` on the wire and the `slots` array
// (lib/consult/captureContract.ts), so the early photo would have shown up as a
// fourth "todo" slot, changed every N/M counter, and bumped all three pack
// versions — and pack versions are pinned by stored revisions and a database
// trigger, so that is a migration plus a re-pin for a photo that is not part of
// the guided set at all.
//
// It is resolved from HERE instead, by the registry, for every family. That is
// a stronger guarantee than membership: there is no per-pack array for a new
// pack to forget it from, so a family nobody has modelled yet still gets the
// photo that unlocks its booking.

import type { ConsultCaptureShotDTO } from '@/lib/dto/consult'

import type { ConsultCaptureShotDefinition } from './types'

/** The one key this stage writes. Widened into the DB shotKey CHECK by P7a-1. */
export const CONSULT_EARLY_PHOTO_SHOT_KEY = 'early_photo'

/**
 * The pack version stored on an early capture.
 *
 * The early photo belongs to no pack, but `ConsultCapture.shotPackVersion` is
 * NOT NULL and the capture guard requires the upload and the capture to agree
 * on it. 1 keeps it inside the existing `BETWEEN 1 AND 2` CHECK, so this
 * slice does not have to widen that constraint as well — and the value is
 * honest: there has only ever been one version of this shot.
 */
export const CONSULT_EARLY_PHOTO_PACK_VERSION = 1

export const EARLY_PHOTO_SHOT: ConsultCaptureShotDefinition = Object.freeze({
  key: CONSULT_EARLY_PHOTO_SHOT_KEY,
  title: 'What you have right now',
  instruction:
    'One photo of you as you are — camera or camera roll, whatever light you are in. It does not need to be a good photo.',
  requirement: 'REQUIRED',
  // The gate is told to look for one thing only: is there a person here. Every
  // other finding is reported so it can be STORED as a warning, and the prompt
  // says so plainly, because a model told "accept almost everything" tends to
  // answer PASS and volunteer nothing — and the warnings are the whole reason
  // the analysis later knows to discount this frame.
  acceptance:
    'Accept whenever a person is visible at all. This photo is deliberately casual: it may be dim, bright, blurry, filtered, oddly cropped, warmly lit, or show no hair, and NONE of those are refusals — report the finding anyway and it is recorded as a warning on an accepted photo. Use SUBJECT_NOT_VISIBLE, and only SUBJECT_NOT_VISIBLE, when there is no readable person in the frame at all.',
  // Never consulted for a WARN_ONLY shot; set to the honest reading of the
  // instruction so the value is not a lie if the gate ever changes.
  framing: 'FULL_VIEW',
  gate: 'WARN_ONLY',
})

/**
 * The wire half of the shot, for the thread's photo-request message.
 *
 * Derived from the definition rather than retyped, so the title the client
 * reads and the acceptance rule the gate is given can never describe two
 * different photographs. The server-only fields (`acceptance`, `framing`,
 * `gate`) are dropped here exactly as `buildState` drops them for pack shots.
 */
export const EARLY_PHOTO_SHOT_DTO: ConsultCaptureShotDTO = Object.freeze({
  key: EARLY_PHOTO_SHOT.key,
  title: EARLY_PHOTO_SHOT.title,
  instruction: EARLY_PHOTO_SHOT.instruction,
  requirement: EARLY_PHOTO_SHOT.requirement,
})

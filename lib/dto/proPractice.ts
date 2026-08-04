// lib/dto/proPractice.ts
//
// Wire DTOs for the pro PRACTICE library — the shots a pro takes with the
// standalone camera (the footer's centre button when no session is live).
//
//   - POST   /api/v1/pro/practice             (confirm a signed upload)
//   - GET    /api/v1/pro/practice             (the library)
//   - DELETE /api/v1/pro/practice/[id]        (drop one shot)
//   - POST   /api/v1/pro/practice/[id]/attach (promote it to real media)
//
// A practice shot is deliberately NOT a MediaAsset (see the PracticeShot model
// in prisma/schema.prisma): it has no booking and no service anchor, so nothing
// is owed on it and it cannot appear in any portfolio / Looks / chart / booking
// query. `attachedMediaId` is set once the pro promotes one; the practice row
// stays in the library afterwards, marked as used.
//
// Internal storage pointers (bucket/path) are dropped from the wire, like every
// other media DTO — `renderUrl` is the short-lived signed URL to render from.

import type { MediaType } from '@prisma/client'

import type { ProLookPublicationResultDto } from '@/lib/looks/publication/contracts'
import type { ProBookingMediaItemDTO, ProMediaCreatedDTO } from '@/lib/dto/mediaAttach'

// ── One shot in the library ──────────────────────────────────────────────────

export type ProPracticeShotDTO = {
  id: string
  mediaType: MediaType
  caption: string | null
  createdAt: string // ISO-8601
  // Normalized subject focal point in [0,1] from the top-left, or null (center).
  focalX: number | null
  focalY: number | null
  // Non-null once this shot has been attached to a booking or published as a
  // look. The shot stays in the library either way — this is a "used" marker,
  // not a tombstone.
  attachedMediaId: string | null
  attachedAt: string | null // ISO-8601
  // Short-lived signed URL (private bucket, ~10-min TTL). Null if signing failed.
  renderUrl: string | null
}

// ── POST /api/v1/pro/practice ────────────────────────────────────────────────

export type ProPracticeCreateResponseDTO = {
  shot: ProPracticeShotDTO
}

// ── GET /api/v1/pro/practice ─────────────────────────────────────────────────

export type ProPracticeListResponseDTO = {
  items: ProPracticeShotDTO[]
}

// ── POST /api/v1/pro/practice/[id]/attach ────────────────────────────────────

// Which of the two promotions ran. BOOKING copies the bytes into the booking's
// private namespace and records a PRO_CLIENT session asset; LOOK copies them
// into the public bucket and records a PUBLIC asset (+ a LookPost).
export type ProPracticeAttachTarget = 'BOOKING' | 'LOOK'

export type ProPracticeAttachResponseDTO = {
  target: ProPracticeAttachTarget
  // The practice shot, re-read after the attach (so `attachedMediaId` /
  // `attachedAt` are populated).
  shot: ProPracticeShotDTO
  // Present for target BOOKING — the session media item that was created.
  bookingMedia?: ProBookingMediaItemDTO
  // Present for target LOOK — the created public asset…
  media?: ProMediaCreatedDTO
  // …and its LookPost, when one was created/updated.
  lookPublication?: ProLookPublicationResultDto
}

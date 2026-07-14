// lib/dto/mediaAttach.ts
//
// Wire DTOs for the media *attach* endpoints — the three routes that persist a
// MediaAsset (and, for portfolio uploads, a LookPost) once a signed upload has
// landed in storage:
//
//   - POST /api/v1/pro/media                     (portfolio / looks upload)
//   - GET  /api/v1/pro/bookings/[id]/media       (session media list)
//   - POST /api/v1/pro/bookings/[id]/media       (session media upload)
//   - POST /api/v1/client/reviews/[id]/media     (review media upload)
//
// Historically these returned entire Prisma rows (full MediaAsset / Review,
// incl. internal columns like proTenantId / storageBucket / storagePath /
// idempotencyKey). That is the raw-payload leakage #397 stripped from the wire
// contract, so they were held out. These DTOs are the picked, JSON-safe shapes
// the routes now build explicitly (`satisfies`-enforced at the return site):
// internal storage pointers are dropped, Decimal/Date are serialized, and only
// the fields a consumer could meaningfully read are carried. The `lookPublication`
// field reuses the already-clean `ProLookPublicationResultDto` from the looks
// publication contracts rather than re-declaring a parallel shape.

import type {
  MediaPhase,
  MediaType,
  MediaVisibility,
  SessionStep,
} from '@prisma/client'

import type { ProLookPublicationResultDto } from '@/lib/looks/publication/contracts'

// ── POST /api/v1/pro/media ───────────────────────────────────────────────────

// One service tag on a created portfolio asset (the full Service row is NOT
// exposed — only the id + display name).
export type ProMediaServiceTagDTO = {
  serviceId: string
  name: string
}

// The created MediaAsset, picked. `url`/`thumbUrl` are the canonical public
// pointers (null for private-bucket assets, which render via signed URLs
// elsewhere). Internal storage columns are intentionally omitted.
export type ProMediaCreatedDTO = {
  id: string
  professionalId: string
  primaryServiceId: string
  mediaType: MediaType
  visibility: MediaVisibility
  caption: string | null
  isFeaturedInPortfolio: boolean
  isEligibleForLooks: boolean
  url: string | null
  thumbUrl: string | null
  createdAt: string // ISO-8601
  services: ProMediaServiceTagDTO[]
}

export type ProMediaCreateResponseDTO = {
  media: ProMediaCreatedDTO
  // Present only when the upload was eligible for Looks and a LookPost was
  // created/updated. Reuses the looks publication wire DTO.
  lookPublication?: ProLookPublicationResultDto
}

// ── GET /api/v1/pro/media ────────────────────────────────────────────────────

// One item in the pro's own media library — the native counterpart of the
// RSC-only web media manager (`/pro/media` grid + the `OwnerMediaMenu` editor).
// Carries every field that editor reads/writes: caption, the Looks/portfolio
// flags, the current service tags, the before/after pairing pointer, and the
// media type/visibility. Storage pointers are dropped; `renderUrl`/
// `renderThumbUrl` are the short-lived signed URLs the grid renders from, with
// `url`/`thumbUrl` mirroring the stored public pointers as a fallback.
export type ProManagedMediaItemDTO = {
  id: string
  mediaType: MediaType
  visibility: MediaVisibility
  caption: string | null
  createdAt: string // ISO-8601
  reviewId: string | null
  isEligibleForLooks: boolean
  isFeaturedInPortfolio: boolean
  // §18d — true when this media is the pro's current creator-page cover banner
  // (`ProfessionalProfile.coverMediaAssetId`). Lets the native media manager mark
  // the cover tile + offer "Remove cover" (§18e).
  isCoverMedia: boolean
  // The paired "before" asset id when this featured "after" has one; null when
  // unpaired. Fed to the pairing editor.
  beforeAssetId: string | null
  services: ProMediaServiceTagDTO[]
  url: string | null
  thumbUrl: string | null
  renderUrl: string | null
  renderThumbUrl: string | null
}

// GET — the pro's whole library plus the taggable service options the editor
// needs (the active Service taxonomy the PATCH validates `serviceIds` against),
// returned alongside so the editor is a single round-trip (mirrors the web
// detail page loading `serviceOptions` next to the media it edits). Each option
// is a `{ serviceId, name }` pair; `serviceId` is the id to send in `serviceIds`.
export type ProManagedMediaListResponseDTO = {
  items: ProManagedMediaItemDTO[]
  serviceOptions: ProMediaServiceTagDTO[]
}

// ── GET + POST /api/v1/pro/bookings/[id]/media ───────────────────────────────

// A booking-session media item. `renderUrl`/`renderThumbUrl` are short-lived
// signed URLs (private bucket, ~10-min TTL); `url`/`thumbUrl` mirror them so a
// consumer reading either key gets a usable URL. Storage pointers are dropped.
export type ProBookingMediaItemDTO = {
  id: string
  mediaType: MediaType
  visibility: MediaVisibility
  phase: MediaPhase
  caption: string | null
  createdAt: string // ISO-8601
  reviewId: string | null
  isEligibleForLooks: boolean
  isFeaturedInPortfolio: boolean
  url: string | null
  thumbUrl: string | null
  renderUrl: string | null
  renderThumbUrl: string | null
}

// GET — the list for a booking (optionally filtered by phase).
export type ProBookingMediaListResponseDTO = {
  items: ProBookingMediaItemDTO[]
  // True when the client has granted media-use consent for this session
  // (`Booking.mediaUseConsentAt` is set) — i.e. the pro's publish action is
  // unlocked for the whole session's media (alongside review-promotion; see
  // lib/media/publicShareGuard.ts). Booking-scoped, not per-item: lets the pro
  // see "client approved sharing ✓ / not yet" before a publish attempt fails
  // the share guard, rather than only discovering consent at publish time.
  clientUseConsent: boolean
}

// POST — the freshly-attached item plus the session step it advanced to (null
// when no advance happened).
export type ProBookingMediaCreateResponseDTO = {
  item: ProBookingMediaItemDTO
  advancedTo: SessionStep | null
}

// ── POST /api/v1/client/reviews/[id]/media ───────────────────────────────────

// A review media asset summary (no signed render URLs — these are the stored
// public pointers from the review row).
export type ClientReviewMediaAssetSummaryDTO = {
  id: string
  mediaType: MediaType
  visibility: MediaVisibility
  createdAt: string // ISO-8601
  url: string | null
  thumbUrl: string | null
}

// A freshly-created review media asset, carrying the signed render URLs the
// client just resolved (private review media renders via these).
export type ClientReviewMediaCreatedDTO = {
  id: string
  mediaType: MediaType
  visibility: MediaVisibility
  createdAt: string // ISO-8601
  url: string | null
  thumbUrl: string | null
  renderUrl: string | null
  renderThumbUrl: string | null
}

// The review the media was attached to, picked. Internal columns
// (idempotencyKey / requestId / clientId / helpfulCount) are omitted.
export type ClientReviewMediaReviewDTO = {
  id: string
  rating: number
  headline: string | null
  body: string | null
  createdAt: string // ISO-8601
  professionalId: string
  bookingId: string | null
  mediaAssets: ClientReviewMediaAssetSummaryDTO[]
}

export type ClientReviewMediaCreateResponseDTO = {
  createdCount: number
  created: ClientReviewMediaCreatedDTO[]
  review: ClientReviewMediaReviewDTO | null
}

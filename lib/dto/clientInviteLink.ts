// lib/dto/clientInviteLink.ts
//
// Wire contract for GET /api/v1/client/referrals/invite-link.

export type ClientInviteLinkResponseDTO = {
  cardId: string
  /** Raw short code (Crockford-ish Base32). */
  shortCode: string
  /** TOV-XXXX-XXXX display form. */
  shortCodeDisplay: string
  /** Root-relative share path (/c/{shortCode}); clients absolutize it. */
  path: string
}

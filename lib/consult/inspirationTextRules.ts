// Client-safe inspiration free-text rules. The server validator
// (inspirationPack.ts) enforces these on write; the web wizard imports the
// SAME values to block a doomed submit with a readable message instead of the
// opaque 400 (inspirationPack itself pulls node:util, so it cannot ship to the
// browser). Change the rule here and both sides move together.

export const CONSULT_INSPIRATION_TEXT_MAX_CHARS = 240

/**
 * Inspiration notes describe the look in the reference photo, never the
 * client's own traits — face/eye/skin/body language is refused durably
 * (C10-W2 boundary; unchanged by the 2026-08-26 full-analysis decisions,
 * which opened cosmetic trait OBSERVATIONS by the model, not free text
 * ABOUT traits from the client).
 */
export const CONSULT_INSPIRATION_UNSUPPORTED_TRAIT_LANGUAGE =
  /\b(face|facial|eye|eyes|skin|undertone|complexion|identity|ethnic|ethnicity|race|health|medical|diagnosis|body|attractive|attractiveness)\b/i

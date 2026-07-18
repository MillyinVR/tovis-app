// lib/media/uploadLimits.ts
//
// The single knob for the per-object upload cap. Every signing route enforces
// it server-side and every upload form validates against it client-side, so
// the two can never disagree again (this replaces the 200MB-form / 30MB-route
// contradiction, plus four hand-copied `30 * 1024 * 1024` literals).
//
// The declared-size check in the signing routes is client-asserted; the hard
// backstop behind it is Supabase storage's project-level file-size limit —
// keep that setting >= this cap when changing the number.

export const UPLOAD_MAX_MB = 30

export const UPLOAD_MAX_BYTES = UPLOAD_MAX_MB * 1024 * 1024

/** For user-facing copy and error messages: "30MB". */
export const UPLOAD_MAX_LABEL = `${UPLOAD_MAX_MB}MB`

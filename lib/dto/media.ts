// lib/dto/media.ts
//
// Wire DTOs for the media signing / URL-resolution endpoints. These are the
// pieces a native upload flow drives: resolve a signed display URL, and the
// sign→PUT→attach handshake's "init" responses.
//
// All shapes are JSON-safe (cacheBuster is a number — milliseconds — not a Date;
// URLs and tokens are strings). The pro/client upload-init responses share one
// shape; admin uploads have their own (init) plus a finalize response.

// GET /api/v1/media/url — a single renderable/signed URL (private URLs expire).
export type MediaSignedUrlDTO = {
  url: string
}

// POST /api/v1/pro/uploads and POST /api/v1/client/uploads — signed-upload init.
export type MediaUploadInitDTO = {
  kind: string
  bucket: string
  path: string
  token: string
  signedUrl: string | null
  publicUrl: string | null
  isPublic: boolean
  cacheBuster: number
  uploadSessionId: string | null
}

// POST /api/v1/admin/uploads — signed-upload init (no session/kind/isPublic).
export type MediaAdminUploadInitDTO = {
  bucket: string
  path: string
  token: string
  publicUrl: string
  cacheBuster: number
}

// POST /api/v1/admin/uploads (finalize) — the committed default image URL.
export type MediaAdminUploadFinalizeDTO = {
  defaultImageUrl: string
}

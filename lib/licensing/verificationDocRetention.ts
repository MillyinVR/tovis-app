// lib/licensing/verificationDocRetention.ts
//
// Retention sweep for VerificationDocument raw files. Design (Tori approved
// 2026-08-06): the raw file (imageUrl/url) is auto-deleted 90 days after the
// verification DECISION (reviewedAt — stamped by the admin PATCH route the
// moment a pro's verificationStatus resolves to APPROVED or REJECTED); the
// outcome and metadata (type, label, status, reviewedAt, adminNote,
// reviewedByAdminId) are kept forever as the audit trail. A doc still PENDING
// (reviewedAt null) has no decision yet, so it's never a candidate.
//
// Idempotent: `fileDeletedAt` gates the query, so a repeated run only ever
// touches rows whose file hasn't been purged yet — a per-item failure just
// leaves that row candidate again on the next run.
import 'server-only'

import { prisma } from '@/lib/prisma'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { parseSupabasePointer } from '@/lib/media'
import { captureLicensingException } from '@/lib/observability/licensingEvents'
import { safeError } from '@/lib/security/logging'

/** Days after the verification decision before the raw file is purged. */
export const VERIFICATION_DOC_RETENTION_DAYS = 90

const MS_PER_DAY = 24 * 60 * 60 * 1000

export type VerificationDocRetentionResult = {
  considered: number
  purged: number
  failed: number
}

type RetentionCandidate = {
  id: string
  professionalId: string
  imageUrl: string | null
  url: string | null
}

/**
 * Runs one retention pass. Per-document failures (a storage error, a
 * malformed pointer) are captured and skipped rather than aborting the whole
 * sweep — one bad row must not block the other 89-day-old rows behind it.
 */
export async function runVerificationDocRetentionSweep(
  now: Date = new Date(),
  opts: { retentionDays?: number } = {},
): Promise<VerificationDocRetentionResult> {
  const retentionDays = opts.retentionDays ?? VERIFICATION_DOC_RETENTION_DAYS
  const cutoff = new Date(now.getTime() - retentionDays * MS_PER_DAY)

  const candidates = await prisma.verificationDocument.findMany({
    where: {
      reviewedAt: { lte: cutoff },
      fileDeletedAt: null,
      OR: [{ imageUrl: { not: null } }, { url: { not: null } }],
    },
    select: { id: true, professionalId: true, imageUrl: true, url: true },
  })

  let purged = 0
  let failed = 0

  for (const doc of candidates) {
    try {
      await purgeVerificationDocumentFile(doc, now)
      purged += 1
    } catch (error) {
      failed += 1
      console.error('license-doc-retention: failed to purge document', {
        documentId: doc.id,
        error: safeError(error),
      })
      captureLicensingException({
        error,
        route: 'lib/licensing/verificationDocRetention.runVerificationDocRetentionSweep',
        event: 'VERIFICATION_DOC_RETENTION_PURGE_FAILED',
        professionalId: doc.professionalId,
        documentId: doc.id,
      })
    }
  }

  return { considered: candidates.length, purged, failed }
}

/**
 * Deletes the raw storage object(s) for one document, then nulls the URL
 * fields and stamps fileDeletedAt in the same write. A pointer this codebase
 * doesn't recognize (never observed in practice — uploads are gated to
 * supabase://media-private/... at write time) is skipped rather than thrown
 * on, so a single malformed legacy row can't wedge the sweep forever; the URL
 * fields are still cleared below.
 */
async function purgeVerificationDocumentFile(
  doc: RetentionCandidate,
  now: Date,
): Promise<void> {
  const admin = getSupabaseAdmin()

  for (const raw of [doc.imageUrl, doc.url]) {
    if (!raw) continue
    const ptr = parseSupabasePointer(raw)
    if (!ptr) continue

    const { error } = await admin.storage.from(ptr.bucket).remove([ptr.path])
    if (error) {
      throw new Error(
        `storage remove failed for ${ptr.bucket}/${ptr.path}: ${error.message}`,
      )
    }
  }

  await prisma.verificationDocument.update({
    where: { id: doc.id },
    data: { imageUrl: null, url: null, fileDeletedAt: now },
  })
}

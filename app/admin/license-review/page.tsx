// app/admin/license-review/page.tsx
//
// Dedicated queue for pros whose license/registration needs manual review —
// the human backstop for credentials we can't auto-verify (out-of-state and
// specialty credentials, plus CA BreEZe timeouts/failures). Distinct from the
// general Professionals directory: license-focused, oldest-first, with inline
// approve/reject and one-click doc viewing.

import Link from 'next/link'
import { redirect } from 'next/navigation'

import RemoteImage from '@/app/_components/media/RemoteImage'
import { prisma } from '@/lib/prisma'
import { platformCrossTenantProVisibilityFilter } from '@/lib/tenant'
import { getAdminUiPerms } from '@/lib/adminUiPermissions'
import { formatPublicProfileDisplayName } from '@/lib/profiles/publicProfileFormatting'
import { isRecord } from '@/lib/guards'
import {
  VerificationDocumentType,
  VerificationStatus,
} from '@prisma/client'
import AdminGuard from '../_components/AdminGuard'
import LicenseReviewActions from './LicenseReviewActions'

export const dynamic = 'force-dynamic'

const QUEUE_STATUSES = [
  VerificationStatus.PENDING,
  VerificationStatus.NEEDS_INFO,
] as const

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-surfaceGlass/12 bg-bgSecondary px-3 py-1 text-[11px] font-black text-textPrimary">
      {children}
    </span>
  )
}

// The register flow stores a context note on licenseRawJson (e.g. "Out-of-state
// /specialty credential; manual review required", "DCA timeout at signup").
function pendingReason(raw: unknown): string | null {
  if (!isRecord(raw)) return null
  const note = raw.note
  return typeof note === 'string' && note.trim() ? note.trim() : null
}

function timeAgo(date: Date): string {
  const ms = Date.now() - date.getTime()
  const days = Math.floor(ms / 86_400_000)
  if (days >= 1) return `${days}d ago`
  const hours = Math.floor(ms / 3_600_000)
  if (hours >= 1) return `${hours}h ago`
  const mins = Math.max(1, Math.floor(ms / 60_000))
  return `${mins}m ago`
}

function fullName(firstName: string | null, lastName: string | null): string | null {
  const name = [firstName?.trim(), lastName?.trim()].filter(Boolean).join(' ')
  return name || null
}

// YYYY-MM-DD for the date input default value.
function toDateInputValue(date: Date | null): string {
  if (!date) return ''
  return date.toISOString().slice(0, 10)
}

export default async function AdminLicenseReviewPage() {
  const info = await getAdminUiPerms()
  if (!info) redirect('/login?from=/admin/license-review')
  if (!info.perms.canReviewPros) redirect('/admin')

  const pros = await prisma.professionalProfile.findMany({
    // Platform-operator surface: intentionally reads across all tenants.
    where: {
      ...platformCrossTenantProVisibilityFilter(),
      AND: [
        // Needs a decision: awaiting initial review, OR an approved pro who
        // edited their license info and needs a re-review.
        {
          OR: [
            { verificationStatus: { in: [...QUEUE_STATUSES] } },
            { licenseReviewPending: true },
          ],
        },
        // A credential is actually in play (excludes makeup/other exempt pros
        // who only ever submit a certificate, not a license).
        {
          OR: [
            { licenseNumber: { not: null } },
            { verificationDocs: { some: { type: VerificationDocumentType.LICENSE } } },
          ],
        },
      ],
    },
    select: {
      id: true,
      businessName: true,
      firstName: true, // pii-plaintext-read-ok: admin-only operator review surface
      lastName: true, // pii-plaintext-read-ok: admin-only operator review surface
      professionType: true,
      licenseState: true,
      licenseNumber: true,
      licenseExpiry: true,
      licenseReviewPending: true,
      licenseRawJson: true,
      verificationStatus: true,
      user: { select: { email: true } },
      verificationDocs: {
        where: { type: VerificationDocumentType.LICENSE },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { id: true, status: true, createdAt: true },
      },
    },
    take: 300,
  })

  // Oldest waiting first (SLA): sort by the earliest LICENSE doc; pros still
  // awaiting an upload (no doc) sink to the bottom.
  const rows = pros
    .map((p) => {
      const latestDoc = p.verificationDocs[0] ?? null
      return { pro: p, latestDoc, hasDoc: Boolean(latestDoc) }
    })
    .sort((a, b) => {
      if (a.hasDoc !== b.hasDoc) return a.hasDoc ? -1 : 1
      const at = a.latestDoc?.createdAt.getTime() ?? 0
      const bt = b.latestDoc?.createdAt.getTime() ?? 0
      return at - bt
    })

  return (
    <AdminGuard>
      <div className="grid gap-4">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h1 className="text-xl font-extrabold text-textPrimary">License review</h1>
            <Pill>{rows.length} awaiting review</Pill>
          </div>
          <p className="text-sm text-textSecondary">
            Credentials we couldn’t auto-verify — out-of-state and specialty
            licenses, plus CA verification failures. Approve once you’ve
            confirmed the license against the issuing board.
          </p>
        </div>

        <div className="grid gap-3">
          {rows.length === 0 ? (
            <div className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4 text-sm text-textSecondary">
              Queue’s clear. Nothing waiting on a license decision.
            </div>
          ) : (
            rows.map(({ pro, latestDoc }) => {
              const reason = pendingReason(pro.licenseRawJson)
              const proName = fullName(pro.firstName, pro.lastName) // pii-plaintext-read-ok: admin-only operator review surface, mirrors the professionals queue
              return (
                <div
                  key={pro.id}
                  className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4"
                >
                  <div className="flex flex-wrap justify-between gap-3">
                    <div className="grid gap-1">
                      <div className="text-sm font-extrabold text-textPrimary">
                        <Link
                          href={`/admin/professionals/${encodeURIComponent(pro.id)}`}
                          className="text-textPrimary hover:underline"
                        >
                          {formatPublicProfileDisplayName({
                            businessName: pro.businessName,
                            fallback: 'Unnamed business',
                          })}
                        </Link>{' '}
                        <span className="text-xs font-bold text-textSecondary">
                          ({pro.user.email}) {/* pii-plaintext-read-ok: admin-only operator review surface, mirrors the professionals queue */}
                        </span>
                      </div>

                      {proName ? (
                        <div className="text-sm text-textPrimary">{proName}</div>
                      ) : null}

                      <div className="text-sm text-textSecondary">
                        {pro.professionType || 'Unknown profession'} ·{' '}
                        {pro.licenseState || '??'}
                      </div>

                      <div className="text-xs text-textSecondary">
                        License #: {pro.licenseNumber || '—'}
                        {' · '}
                        {pro.licenseExpiry ? (
                          <span>expires {pro.licenseExpiry.toLocaleDateString()}</span>
                        ) : (
                          <span className="text-toneWarn">no expiry on file</span>
                        )}
                        {latestDoc ? (
                          <span> · doc uploaded {timeAgo(latestDoc.createdAt)}</span>
                        ) : (
                          <span className="text-toneWarn"> · awaiting upload</span>
                        )}
                      </div>

                      {reason ? (
                        <div className="text-xs text-textSecondary/80">{reason}</div>
                      ) : null}
                    </div>

                    <div className="flex flex-col items-end gap-2">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Pill>{String(pro.verificationStatus)}</Pill>
                        {pro.licenseReviewPending ? <Pill>Re-review</Pill> : null}
                      </div>

                      {latestDoc ? (
                        <a
                          href={`/api/admin/verification-docs/open?id=${encodeURIComponent(latestDoc.id)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="block text-right"
                          title="Open full size"
                        >
                          <RemoteImage
                            src={`/api/admin/verification-docs/open?id=${encodeURIComponent(latestDoc.id)}`}
                            alt="License document"
                            className="h-20 w-32 rounded-lg border border-surfaceGlass/14 bg-bgPrimary/30 object-cover"
                            width={128}
                            height={80}
                          />
                          <span className="mt-1 block text-[11px] font-black text-accentPrimary">
                            View larger ↗
                          </span>
                        </a>
                      ) : null}
                      <LicenseReviewActions
                        professionalId={pro.id}
                        currentStatus={pro.verificationStatus}
                        initialExpiry={toDateInputValue(pro.licenseExpiry)}
                        hasLicenseDoc={Boolean(latestDoc)}
                      />
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </AdminGuard>
  )
}

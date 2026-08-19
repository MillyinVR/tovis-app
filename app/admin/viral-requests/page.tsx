// app/admin/viral-requests/page.tsx
//
// The review queue for viral look submissions — the surface that did not exist.
//
// `POST /api/v1/admin/viral-service-requests/[id]/moderate` has worked
// end-to-end for a while (mark-in-review / approve / reject, with the approval
// fan-out to matching pros behind it), and `emitAdminViralRequestPending` has
// been paging admins about new submissions the whole time. Neither had anywhere
// to land: `app/admin/` carried no viral page at all, so the only way to action
// a request was to call the endpoint by hand.
//
// This is also where a reviewer sets the picture the look is published under —
// see ViralRequestCoverUploader for why that belongs to review rather than to
// the submitter alone.
//
// Follows the license-review convention: server component, direct prisma read,
// permission checked on the PAGE as well as on every route the actions call.

import { redirect } from 'next/navigation'

import RemoteImage from '@/app/_components/media/RemoteImage'
import { getAdminUiPerms } from '@/lib/adminUiPermissions'
import { prisma } from '@/lib/prisma'
import { formatInTimeZone } from '@/lib/time'
import {
  isViralRequestAwaitingReview,
  listAdminViralRequests,
} from '@/lib/viralRequests'
import {
  readViralSubmitterMedia,
  resolveViralCoverImage,
} from '@/lib/viralRequests/contracts'

import { Badge } from '@/app/_components/ui'
import AdminGuard from '../_components/AdminGuard'
import ViralRequestActions from './ViralRequestActions'
import ViralRequestCoverUploader from './ViralRequestCoverUploader'
import ViralRequestSubmitterMedia from './ViralRequestSubmitterMedia'

export const dynamic = 'force-dynamic'

function statusTone(status: string): 'neutral' | 'warn' | 'success' | 'danger' {
  if (status === 'APPROVED') return 'success'
  if (status === 'REJECTED') return 'danger'
  if (status === 'IN_REVIEW') return 'warn'
  return 'neutral'
}

export default async function AdminViralRequestsPage() {
  const info = await getAdminUiPerms()
  if (!info) redirect('/login?from=/admin/viral-requests')
  // Same permission the moderation endpoint enforces — a reviewer who could not
  // action a row should not be shown the queue either.
  if (!info.perms.canReviewPros) redirect('/admin')

  const rows = await listAdminViralRequests(prisma)
  const awaiting = rows.filter((row) => isViralRequestAwaitingReview(row.status))

  return (
    <AdminGuard>
      <div className="grid gap-4">
        <div className="grid gap-1">
          {/* The count sits UNDER the heading, not opposite it: the admin shell
              floats its own view-switcher in the top-right corner, and a pill
              on that row is half-hidden behind it. */}
          <h1 className="text-xl font-extrabold text-textPrimary">Viral looks</h1>
          <div>
            <Badge fill="soft" tone={awaiting.length > 0 ? 'warn' : 'neutral'}>
              {awaiting.length} awaiting review
            </Badge>
          </div>
          <p className="text-sm text-textSecondary">
            Looks clients have spotted and asked us to name. Approving one fans
            it out to every pro offering its category, so give it a cover image
            first — that picture is what the look is shown by everywhere.
          </p>
        </div>

        <div className="grid gap-3">
          {rows.length === 0 ? (
            <div className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4 text-sm text-textSecondary">
              No viral look submissions yet.
            </div>
          ) : (
            rows.map((row) => {
              // What the client sent, and what a reviewer chose to publish —
              // two different things, and only the second reaches a client.
              const cover = resolveViralCoverImage(row)
              const submitted = readViralSubmitterMedia(row)
              const canAct = isViralRequestAwaitingReview(row.status)

              return (
                <div
                  key={row.id}
                  className="rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="grid min-w-0 flex-1 gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-extrabold text-textPrimary">
                          {row.name}
                        </span>
                        <Badge fill="soft" tone={statusTone(row.status)}>{row.status}</Badge>
                        {row.reportCount > 0 ? (
                          <Badge fill="soft" tone="danger">{row.reportCount} reported</Badge>
                        ) : null}
                      </div>

                      <div className="text-[12px] text-textSecondary">
                        Submitted{' '}
                        {formatInTimeZone(row.createdAt, 'UTC', {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: 'numeric',
                          minute: '2-digit',
                        })}{' '}
                        UTC
                      </div>

                      {row.sourceUrl ? (
                        <a
                          href={row.sourceUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="truncate text-[12px] text-accentPrimary hover:underline"
                        >
                          {row.sourceUrl}
                        </a>
                      ) : (
                        <span className="text-[12px] text-textMuted">
                          No source link
                        </span>
                      )}

                      {/*
                        Named because it decides the fan-out: matching runs on
                        `requestedCategoryId`, so approving a request without one
                        notifies nobody and looks like a broken approval.
                      */}
                      <div className="text-[12px] text-textMuted">
                        {row.requestedCategory ? (
                          <>Category: {row.requestedCategory.name}</>
                        ) : (
                          <span className="text-toneWarn">
                            No category — approving this notifies no pros.
                          </span>
                        )}
                      </div>

                      {row.description ? (
                        <p className="mt-1 max-w-[70ch] text-[12.5px] leading-relaxed text-textSecondary">
                          {row.description}
                        </p>
                      ) : null}

                      {row.adminNotes ? (
                        <p className="mt-1 text-[12px] italic text-textMuted">
                          Notes: {row.adminNotes}
                        </p>
                      ) : null}

                      <ViralRequestSubmitterMedia
                        requestId={row.id}
                        media={submitted}
                        coverImage={cover}
                      />
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <div className="grid h-[92px] w-[164px] place-items-center overflow-hidden rounded-[12px] border border-surfaceGlass/12 bg-bgPrimary">
                        {cover ? (
                          <RemoteImage
                            src={cover}
                            alt={`${row.name} cover`}
                            className="h-full w-full object-cover"
                            width={164}
                            height={92}
                          />
                        ) : (
                          <span className="text-[11px] text-textMuted">
                            No cover
                          </span>
                        )}
                      </div>

                      <ViralRequestCoverUploader
                        requestId={row.id}
                        hasCover={Boolean(row.coverImageUrl)}
                      />

                      <ViralRequestActions
                        requestId={row.id}
                        canAct={canAct}
                        hasCover={cover !== null}
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

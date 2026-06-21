// app/pro/verification/page.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { VerificationStatus } from '@prisma/client'
import {
  verificationDocTypeLabel,
  verificationMethodsForProfession,
} from '@/lib/pro/verification/methods'
import VerificationUploadClient from './VerificationUploadClient'
import DeleteDocButton from './DeleteDocButton'
import LicenseEditForm from './LicenseEditForm'
import { requiresLicense } from '@/lib/licensing/licenseRequirement'
import RemoteImage from '@/app/_components/media/RemoteImage'

export const dynamic = 'force-dynamic'

function fmtDate(d: Date) {
  return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit' }).format(d)
}

function toDateInputValue(d: Date | null): string {
  return d ? d.toISOString().slice(0, 10) : ''
}

function statusBadgeClasses(status: VerificationStatus): string {
  if (status === VerificationStatus.APPROVED) {
    return 'border-toneSuccess/25 bg-toneSuccess/10 text-toneSuccess'
  }
  if (
    status === VerificationStatus.PENDING ||
    status === VerificationStatus.PENDING_MANUAL_REVIEW
  ) {
    return 'border-toneWarn/25 bg-toneWarn/10 text-toneWarn'
  }
  return 'border-toneDanger/25 bg-toneDanger/10 text-toneDanger'
}

export default async function ProVerificationPage() {
  const user = await getCurrentUser()
  if (!user || user.role !== 'PRO' || !user.professionalProfile) redirect('/login?from=/pro')

  const proId = user.professionalProfile.id

  const pro = await prisma.professionalProfile.findUnique({
    where: { id: proId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      professionType: true,
      verificationStatus: true,
      licenseState: true,
      licenseNumber: true,
      licenseExpiry: true,
      licenseVerified: true,
      verificationDocs: {
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: {
          id: true,
          type: true,
          status: true,
          label: true,
          createdAt: true,
          adminNote: true,
        },
      },
    },
  })

  if (!pro) redirect('/pro')

  const methods = verificationMethodsForProfession(pro.professionType)
  const isLicensed = Boolean(
    pro.professionType && requiresLicense(pro.professionType, pro.licenseState),
  )

  return (
    <main className="mx-auto max-w-3xl pb-24 pt-6 font-sans">
      <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-5">
        <div className="text-lg font-black text-textPrimary">Verification</div>
        <div className="mt-1 text-sm text-textSecondary">
          This controls marketplace visibility + who can book you. (Yes, paperwork is the villain.)
        </div>

        <div className="mt-4 rounded-card border border-white/10 bg-bgPrimary/30 p-4">
          <div className="text-xs font-extrabold text-textSecondary">Status</div>
          <div className="mt-2 text-sm font-black text-textPrimary">{pro.verificationStatus}</div>
          <div className="mt-2 text-xs text-textSecondary">
            License verified: <span className="font-black text-textPrimary">{pro.licenseVerified ? 'YES' : 'NO'}</span>
          </div>
        </div>

        <div className="mt-5 h-px w-full bg-white/10" />

        {/* One "Your license" section: details + photo together, so renewing
            pros update the date AND re-upload in the same place. */}
        <div className="mt-5">
          <div className="text-sm font-black text-textPrimary">
            {isLicensed ? 'Your license' : 'Your certifications'}
          </div>
          <div className="mt-1 text-xs text-textSecondary">
            {isLicensed
              ? 'Keep your details current and upload a clear photo of your license. Both are required before an admin can approve you — and at renewal, update the date and re-upload. We keep it private; only admins can view it.'
              : 'No state license required for your profession. Upload your certificate(s) below. We keep it private; only admins can view it.'}
          </div>

          {isLicensed ? (
            <div className="mt-3">
              <LicenseEditForm
                initialState={pro.licenseState ?? ''}
                initialNumber={pro.licenseNumber ?? ''}
                initialExpiry={toDateInputValue(pro.licenseExpiry)}
              />
            </div>
          ) : null}

          <div className="mt-3">
            <VerificationUploadClient methods={methods} />
          </div>
        </div>

        <div className="mt-6 h-px w-full bg-white/10" />

        <div className="mt-5">
          <div className="text-sm font-black text-textPrimary">Documents</div>

          {pro.verificationDocs.length === 0 ? (
            <div className="mt-2 text-xs text-textSecondary">No documents uploaded yet.</div>
          ) : (
            <div className="mt-3 grid gap-2">
              {pro.verificationDocs.map((d) => (
                <div key={d.id} className="rounded-card border border-white/10 bg-bgPrimary/25 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-xs font-black text-textPrimary">
                        {d.label ?? verificationDocTypeLabel(d.type)}{' '}
                        <span className="text-textSecondary/70">
                          {d.label ? `• ${verificationDocTypeLabel(d.type)} ` : ''}• {fmtDate(d.createdAt)}
                        </span>
                      </div>
                      {d.adminNote ? (
                        <div className="mt-1 text-xs text-textSecondary">Admin note: {d.adminNote}</div>
                      ) : null}
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <div
                        className={[
                          'rounded-full border px-2 py-0.5 text-[11px] font-black',
                          statusBadgeClasses(d.status),
                        ].join(' ')}
                      >
                        {d.status}
                      </div>

                      {d.status === VerificationStatus.PENDING ? (
                        <DeleteDocButton docId={d.id} />
                      ) : null}
                    </div>
                  </div>

                  <a
                    href={`/api/pro/verification-docs/${encodeURIComponent(d.id)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block w-fit"
                    title="Open full size"
                  >
                    <RemoteImage
                      src={`/api/pro/verification-docs/${encodeURIComponent(d.id)}`}
                      alt="Uploaded document preview"
                      className="h-28 w-44 rounded-lg border border-white/10 bg-bgPrimary/30 object-cover"
                      width={176}
                      height={112}
                    />
                    <span className="mt-1 block text-[11px] font-black text-accentPrimary">
                      View larger ↗
                    </span>
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  )
}

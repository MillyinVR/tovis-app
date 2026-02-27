// app/p/[handle]/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import ProSessionFooter from '@/app/_components/ProSessionFooter/ProSessionFooter'
import { isValidIanaTimeZone } from '@/lib/timeZone'

export const dynamic = 'force-dynamic'

function normalizeHandle(raw: string) {
  return raw.trim().toLowerCase()
}

function displayTimeZoneOrNull(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const tz = raw.trim()
  if (!tz) return null
  return isValidIanaTimeZone(tz) ? tz : null
}

export default async function VanityProfilePage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params
  const normalized = normalizeHandle(handle)
  if (!normalized) notFound()

  const viewer = await getCurrentUser().catch(() => null)

  const pro = await prisma.professionalProfile.findUnique({
    where: { handleNormalized: normalized },
    select: {
      id: true,
      userId: true,
      verificationStatus: true,
      businessName: true,
      bio: true,
      avatarUrl: true,
      professionType: true,
      location: true,
      timeZone: true,
      isPremium: true,
    },
  })

  if (!pro) notFound()

  // Same visibility rule as /professionals/[id]
  const isOwner = viewer?.role === 'PRO' && viewer?.professionalProfile?.id === pro.id
  const isApproved = pro.verificationStatus === 'APPROVED'

  if (!isOwner && !isApproved) {
    return (
      <main className="mx-auto max-w-180 px-4 pb-24 pt-10">
        <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="text-[16px] font-black text-textPrimary">This profile is pending verification</div>
          <div className="mt-2 text-[13px] text-textSecondary">
            We’re verifying the professional’s license and details. Check back soon.
          </div>
        </div>

        {viewer?.role === 'PRO' ? <ProSessionFooter /> : null}
      </main>
    )
  }

  const displayName = pro.businessName?.trim() || 'Beauty professional'
  const subtitle = pro.professionType || 'Beauty professional'
  const location = pro.location?.trim() || null
  const proTimeZone = displayTimeZoneOrNull(pro.timeZone)

  return (
    <main className="mx-auto max-w-180 px-4 pb-28 pt-6">
      <section className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="flex items-start justify-between gap-3">
          <Link href="/looks" className="text-[12px] font-black text-textSecondary hover:text-textPrimary">
            ← Back to Looks
          </Link>

          <Link
            href={`/professionals/${pro.id}`}
            className="text-[12px] font-black text-textSecondary hover:text-textPrimary"
            title="Open the full profile route"
          >
            Open full profile →
          </Link>
        </div>

        <div className="mt-4 flex items-start gap-4">
          <div className="h-16 w-16 overflow-hidden rounded-full border border-white/10 bg-bgPrimary/25">
            {pro.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pro.avatarUrl} alt={displayName} className="h-full w-full object-cover" />
            ) : null}
          </div>

          <div className="min-w-0 flex-1">
            <div className="truncate text-[20px] font-black text-textPrimary">{displayName}</div>
            <div className="mt-1 text-[13px] text-textSecondary">
              {subtitle}
              {location ? ` • ${location}` : ''}
            </div>

            {pro.bio ? <div className="mt-3 text-[13px] text-textSecondary">{pro.bio}</div> : null}

            {proTimeZone ? (
              <div className="mt-3 inline-flex rounded-full border border-white/10 bg-bgPrimary/25 px-4 py-2 text-[12px] font-black text-textSecondary">
                Time zone: <span className="ml-2 text-textPrimary">{proTimeZone}</span>
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {viewer?.role === 'PRO' ? <ProSessionFooter /> : null}
    </main>
  )
}
// app/pro/media/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import { prisma } from '@/lib/prisma'
import MediaTile from './MediaTile'

export const dynamic = 'force-dynamic'

export default async function ProMediaPage() {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/media')
  }

  const media = await prisma.mediaAsset.findMany({
    where: { professionalId: user.professionalProfile.id },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: {
      id: true,
      url: true,
      thumbUrl: true,
      caption: true,
      isFeaturedInPortfolio: true,
      reviewId: true, // needed for canFeature
    },
  })

  return (
    <main className="mx-auto max-w-5xl px-4 pb-20 pt-20 font-sans">
      <div className="mb-4 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-black text-textPrimary">My media</h1>
          <p className="mt-1 text-[13px] text-textSecondary">
            Manage posts and choose what appears in your portfolio.
          </p>
        </div>

        <Link
          href="/pro/media/new"
          className="rounded-card border border-white/10 bg-bgSecondary px-3 py-2 text-[12px] font-black text-textPrimary hover:border-white/20"
        >
          + New post
        </Link>
      </div>

      {media.length === 0 ? (
        <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-[13px] text-textSecondary">
          No media yet.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {media.map((m) => (
            <MediaTile
              key={m.id}
              id={m.id}
              src={m.thumbUrl || m.url}
              caption={m.caption}
              isFeaturedInPortfolio={Boolean(m.isFeaturedInPortfolio)}
            />
          ))}
        </div>
      )}
    </main>
  )
}

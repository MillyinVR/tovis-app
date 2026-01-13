// app/pro/media/[id]/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

type PageProps = {
  params: Promise<{ id: string }>
}

function pickString(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

export default async function ProMediaDetailPage({ params }: PageProps) {
  const { id: rawId } = await params
  const id = pickString(rawId)

  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/media')
  }

  if (!id) redirect('/pro/media')

  const media = await prisma.mediaAsset.findUnique({
    where: { id },
    include: {
      services: { include: { service: true } },
      likes: true,
      comments: true,
    },
  })

  if (!media || media.professionalId !== user.professionalProfile.id) {
    redirect('/pro/media')
  }

  const src = media.url
  const isVideo = media.mediaType === 'VIDEO'

  return (
    <main className="mx-auto max-w-5xl px-4 pb-24 pt-20 font-sans">
      <div className="mb-3">
        <Link href="/pro/media" className="text-[12px] font-extrabold text-textSecondary hover:text-textPrimary">
          ← Back to media
        </Link>
      </div>

      <div className="tovis-glass overflow-hidden rounded-card border border-white/10">
        <div className="bg-black/40">
          {isVideo ? (
            <video src={src} controls className="block w-full max-h-[520px]" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={src}
              alt={media.caption || 'Media'}
              className="block w-full max-h-96 object-contain"
            />
          )}
        </div>

        <div className="grid gap-3 p-4">
          {media.caption ? (
            <div className="text-[13px] text-textPrimary">{media.caption}</div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            {media.services?.map((t) => (
              <span
                key={t.id}
                className="rounded-full border border-white/10 bg-bgSecondary px-3 py-1 text-[12px] font-extrabold text-textPrimary"
              >
                {t.service?.name || 'Service'}
              </span>
            ))}
          </div>

          <div className="text-[12px] text-textSecondary">
            {media.likes?.length ?? 0} likes • {media.comments?.length ?? 0} comments
          </div>
        </div>
      </div>
    </main>
  )
}

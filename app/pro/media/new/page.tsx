// app/pro/media/new/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import NewMediaPostForm from './NewMediaPostForm'

export default async function ProNewMediaPostPage() {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/media/new')
  }

  return (
    <main className="mx-auto max-w-2xl px-4 pt-20 pb-20 font-sans">
      <div className="mb-4">
        <Link
          href="/pro/media"
          className="text-[12px] font-extrabold text-textSecondary hover:text-textPrimary"
        >
          ← Back to media
        </Link>
      </div>

      <h1 className="text-[20px] font-black text-textPrimary">New post</h1>
      <p className="mt-1 text-[13px] text-textSecondary">
        Add media, write a caption, tag at least one service. Then decide where it shows.
      </p>

      <div className="mt-4">
        <NewMediaPostForm />
      </div>
    </main>
  )
}

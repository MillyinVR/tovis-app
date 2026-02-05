// app/client/layout.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null)

  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect('/login?from=/client')
  }

  return (
    <div className="min-h-dvh bg-bgPrimary text-textPrimary">
      <div className="mx-auto w-full max-w-5xl px-4 pt-4">{children}</div>
    </div>
  )
}

import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

const CLIENT_HOME = '/client'

function loginHref(from: string): string {
  return `/login?from=${encodeURIComponent(from)}`
}

function verifyHref(next: string): string {
  return `/verify-phone?next=${encodeURIComponent(next)}`
}

export default async function ClientLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const user = await getCurrentUser().catch(() => null)

  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect(loginHref(CLIENT_HOME))
  }

  if (user.sessionKind !== 'ACTIVE' || !user.isFullyVerified) {
    redirect(verifyHref(CLIENT_HOME))
  }

  return (
    <div className="min-h-dvh bg-bgPrimary text-textPrimary">
      <div className="mx-auto w-full max-w-5xl px-4 pt-4">{children}</div>
    </div>
  )
}
// app/client/layout.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import ClientSessionFooter from '../_components/ClientSessionFooter/ClientSessionFooter'

export const dynamic = 'force-dynamic'

const FOOTER_H = '4.5rem' // matches your footer h-18

export default async function ClientLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null)

  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect('/login?from=/client')
  }

  return (
    <div className="fixed inset-0 bg-bgPrimary text-textPrimary">
      {/* Viewport-locked shell */}
      <div className="mx-auto flex h-full w-full max-w-5xl flex-col px-4 pt-4">
        {/* Main content area — MUST be min-h-0 so children can scroll internally */}
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>

        {/* Spacer so content never sits under the fixed footer */}
        <div style={{ height: `calc(${FOOTER_H} + env(safe-area-inset-bottom) + 16px)` }} />
      </div>

      <ClientSessionFooter />
    </div>
  )
}

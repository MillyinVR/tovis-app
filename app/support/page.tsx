// app/support/page.tsx
import { getCurrentUser } from '@/lib/currentUser'
import SupportForm from './supportForm'

export const dynamic = 'force-dynamic'

export default async function SupportPage() {
  const user = await getCurrentUser().catch(() => null)

  const role =
    user?.role === 'PRO'
      ? 'PRO'
      : user?.role === 'CLIENT'
        ? 'CLIENT'
        : user?.role === 'ADMIN'
          ? 'ADMIN'
          : 'GUEST'

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8 text-textPrimary">
      <div className="mb-5">
        <h1 className="text-[22px] font-black">Support</h1>
        <p className="mt-1 text-[13px] text-textSecondary">
          Report an issue, request help, or file a complaint. We’ll review it in the admin queue.
        </p>
      </div>

      <SupportForm role={role} />
    </main>
  )
}

// app/client/settings/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import LogoutButton from '../components/LogoutButton'
import ClientLocationSettings from './ClientLocationSettings'

export const dynamic = 'force-dynamic'

export default async function ClientSettingsPage() {
  const user = await getCurrentUser().catch(() => null)
  if (!user || user.role !== 'CLIENT' || !user.clientProfile?.id) {
    redirect('/login?from=/client/settings')
  }

  const displayName = user.clientProfile?.firstName || user.email || 'there'

  return (
    <main className="mx-auto mt-16 w-full max-w-5xl px-4 pb-14 text-textPrimary">
      <header className="mb-6 flex items-start justify-between gap-3">
        <div>
          <Link href="/client" className="text-xs font-black text-textSecondary hover:text-textPrimary">
            ← Back
          </Link>
          <h1 className="mt-2 text-2xl font-black tracking-tight">Settings</h1>
          <p className="mt-1 text-sm font-semibold text-textSecondary">Hi, {displayName}.</p>
        </div>

        <LogoutButton />
      </header>

      <div className="grid gap-4">
        {/* Location */}
        <section id="location" className="rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <div className="text-sm font-black">Location</div>
            <div className="text-xs font-semibold text-textSecondary">
              Used for “near you” + openings within your radius.
            </div>
          </div>

          <ClientLocationSettings />
        </section>

        {/* Future sections */}
        <section className="rounded-card border border-white/10 bg-bgSecondary p-4">
          <div className="text-sm font-black">Account</div>
          <div className="mt-2 text-sm text-textSecondary">More settings can live here later (notifications, privacy, etc).</div>
        </section>
      </div>
    </main>
  )
}
// app/pro/notifications/settings/page.tsx

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Role } from '@prisma/client'

import NotificationPreferencesForm from '@/app/_components/NotificationPreferencesForm'
import ReminderCadenceSettings from '@/app/pro/notifications/settings/ReminderCadenceSettings'
import { getBrandConfig } from '@/lib/brand'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

export default async function ProNotificationSettingsPage() {
  const user = await getCurrentUser()
  const brand = getBrandConfig()

  if (!user || user.role !== Role.PRO || !user.professionalProfile) {
    redirect('/login?from=/pro/notifications/settings')
  }

  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-4">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-textSecondary">
            {brand.displayName} Pro
          </div>
          <h1 className="mt-1 text-[18px] font-black text-textPrimary">
            Notification settings
          </h1>
          <div className="mt-1 text-[12px] font-semibold text-textSecondary">
            Choose how you hear from us for each kind of update, and set quiet
            hours.
          </div>
        </div>

        <Link
          href="/pro/notifications"
          prefetch={false}
          className="shrink-0 rounded-full border border-surfaceGlass/12 bg-bgPrimary/35 px-3 py-1 text-[11px] font-black text-textSecondary transition hover:text-textPrimary"
        >
          Back
        </Link>
      </div>

      <div className="mb-5">
        <ReminderCadenceSettings />
      </div>

      <NotificationPreferencesForm endpoint="/api/v1/pro/notification-preferences" />
    </main>
  )
}

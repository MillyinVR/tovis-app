// app/client/(gated)/settings/notifications/page.tsx
// iOS: ClientSettingsHubView → "Notifications" → NotificationPreferencesView.
import NotificationPreferencesForm from '@/app/_components/NotificationPreferencesForm'

import ClientPage from '../../_components/ClientPage'

export const dynamic = 'force-dynamic'

export default function ClientNotificationSettingsPage() {
  return (
    <ClientPage
      eyebrow="Settings"
      title="Notifications"
      lede="Choose how you hear from us for each kind of update, and set quiet hours."
      back={{ href: '/client/settings', label: 'Settings' }}
    >
      <section className="brand-glass p-5 sm:p-6">
        <NotificationPreferencesForm
          endpoint="/api/v1/client/notification-preferences"
          showChannelPreference
        />
      </section>
    </ClientPage>
  )
}

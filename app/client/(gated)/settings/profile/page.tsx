// app/client/(gated)/settings/profile/page.tsx
// iOS: ClientSettingsHubView → "Edit profile" → ClientProfileEditView.
import ClientPage from '../../_components/ClientPage'
import ClientProfileSettings from '../ClientProfileSettings'

export const dynamic = 'force-dynamic'

export default function ClientProfileSettingsPage() {
  return (
    <ClientPage
      eyebrow="Settings"
      title="Edit profile"
      lede="Name, phone, birthday and avatar. Your saved addresses are separate, so changing them here never touches where you search or where a pro comes to you."
      back={{ href: '/client/settings', label: 'Settings' }}
    >
      <ClientProfileSettings />
    </ClientPage>
  )
}

// app/client/(gated)/settings/public-profile/page.tsx
// iOS: ClientSettingsHubView → "Public profile" → ClientPublicProfileEditView.
import ClientPage from '../../_components/ClientPage'
import ClientPublicProfileSettings from '../ClientPublicProfileSettings'

export const dynamic = 'force-dynamic'

export default function ClientPublicProfileSettingsPage() {
  return (
    <ClientPage
      eyebrow="Settings"
      title="Public profile"
      lede="Your handle, bio and the looks you choose to make public. Everything else about your account stays private."
      back={{ href: '/client/settings', label: 'Settings' }}
    >
      <ClientPublicProfileSettings />
    </ClientPage>
  )
}

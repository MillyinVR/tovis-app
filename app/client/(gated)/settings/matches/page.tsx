// app/client/(gated)/settings/matches/page.tsx
// iOS: ClientSettingsHubView → "Better matches" → ClientPersonalizationView.
import ClientPage from '../../_components/ClientPage'
import ClientSelfProfileSettings from '../ClientSelfProfileSettings'

export const dynamic = 'force-dynamic'

export default function ClientMatchesSettingsPage() {
  return (
    <ClientPage
      eyebrow="Settings"
      title="Better matches"
      lede="Tell us about your hair, your skin and what you’re into, and the feed and search stop showing you work you’d never book."
      back={{ href: '/client/settings', label: 'Settings' }}
    >
      <ClientSelfProfileSettings />
    </ClientPage>
  )
}

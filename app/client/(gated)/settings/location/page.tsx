// app/client/(gated)/settings/location/page.tsx
// iOS: ClientSettingsHubView → "Discovery location" → ClientDiscoveryLocationView.
import ClientPage from '../../_components/ClientPage'
import ClientLocationSettings from '../ClientLocationSettings'

export const dynamic = 'force-dynamic'

export default function ClientLocationSettingsPage() {
  return (
    <ClientPage
      eyebrow="Settings"
      title="Discovery location"
      lede="This controls nearby search, salon discovery and “near me” browsing. It does not replace your saved service addresses."
      back={{ href: '/client/settings', label: 'Settings' }}
    >
      <section className="brand-glass p-5 sm:p-6">
        <ClientLocationSettings />
      </section>
    </ClientPage>
  )
}

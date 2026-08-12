// app/client/(gated)/settings/addresses/page.tsx
// iOS: ClientSettingsHubView → "Saved addresses" → ClientServiceAddressesView.
import ClientPage from '../../_components/ClientPage'
import ClientAddressesSettings from '../ClientAddressesSettings'

export const dynamic = 'force-dynamic'

export default function ClientAddressesSettingsPage() {
  return (
    <ClientPage
      eyebrow="Settings"
      title="Saved addresses"
      lede="Search areas are for browsing salons nearby. Service addresses are where a mobile pro actually comes — those need a real address."
      back={{ href: '/client/settings', label: 'Settings' }}
      width="wide"
    >
      <section className="brand-glass p-5 sm:p-6">
        <ClientAddressesSettings />
      </section>
    </ClientPage>
  )
}

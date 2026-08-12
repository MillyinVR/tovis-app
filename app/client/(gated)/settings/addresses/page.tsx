// app/client/(gated)/settings/addresses/page.tsx
// iOS: ClientSettingsHubView → "Saved addresses" → ClientServiceAddressesView.
//
// Deliberately NOT width="wide". This is a form, not a grid — `wide` exists for
// grid surfaces that need the extra column (see ClientPageWidth). It was the
// only one of the eight settings sub-routes carrying it, which is invisible at
// 390px (both measures exceed the viewport) but at 768/1280 made this one page
// 1024px against its siblings' 672px, so the measure jumped every time you came
// back to the hub and opened a different row. Its two-column field rows are
// `sm:` and still land at 672.
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
    >
      <section className="brand-glass p-5 sm:p-6">
        <ClientAddressesSettings />
      </section>
    </ClientPage>
  )
}

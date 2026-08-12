// app/client/(gated)/settings/chart-sharing/page.tsx
//
// W5: the client's own control over who can read their chart. An API-only
// revoke is a capability the client has and cannot reach.
//
// This is also the target of CHART_SHARE_SETTINGS_HREF — the in-app row and the
// push a client gets when a pro asks for access both land here. Rows minted
// before the settings split carry `/client/settings#chart-sharing` instead; the
// hub keeps that anchor id so those still land on the right row.
import ClientPage from '../../_components/ClientPage'
import ClientChartSharingSettings from '../ClientChartSharingSettings'

export const dynamic = 'force-dynamic'

export default function ClientChartSharingSettingsPage() {
  return (
    <ClientPage
      eyebrow="Settings"
      title="Who can see your chart"
      lede="Your chart is the private record a pro keeps about you — allergies, formulas, notes, consent forms. Pros you book with can see the record of the work they do for you. Anyone else has to ask, and you can turn it off at any time."
      back={{ href: '/client/settings', label: 'Settings' }}
    >
      <section className="brand-glass p-5 sm:p-6">
        <ClientChartSharingSettings />
      </section>
    </ClientPage>
  )
}

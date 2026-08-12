// app/client/(gated)/settings/account/page.tsx
//
// App Store guideline 5.1.1(v) requires account deletion to be reachable from
// the app, not buried behind a support request. Same panel the pro account
// section renders — the endpoint is role-agnostic, so there is one deletion
// surface, not one per workspace. iOS: ClientSettingsHubView → DeleteAccountView.
import DeleteAccountPanel from '@/app/_components/account/DeleteAccountPanel'

import ClientPage from '../../_components/ClientPage'

export const dynamic = 'force-dynamic'

export default function ClientAccountSettingsPage() {
  return (
    <ClientPage
      eyebrow="Settings"
      title="Delete account"
      lede="Closing your account removes your details. Your pros keep only what they are legally required to keep about work already done."
      back={{ href: '/client/settings', label: 'Settings' }}
    >
      <DeleteAccountPanel />
    </ClientPage>
  )
}

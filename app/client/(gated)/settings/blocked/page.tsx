// app/client/(gated)/settings/blocked/page.tsx
//
// App Store guideline 1.2 requires a UGC app to let a user block abusive users.
// The block itself is made from a person's public profile; this is where the
// list lives so it can be lifted. Same shape as the account-deletion route next
// door — a thin page over a shared panel.
import BlockedAccountsPanel from '@/app/_components/account/BlockedAccountsPanel'

import ClientPage from '../../_components/ClientPage'

export const dynamic = 'force-dynamic'

export default function ClientBlockedAccountsPage() {
  return (
    <ClientPage
      eyebrow="Settings"
      title="Blocked accounts"
      lede="Blocking is mutual: you won’t see their looks or comments, and they won’t see yours."
      back={{ href: '/client/settings', label: 'Settings' }}
    >
      <BlockedAccountsPanel />
    </ClientPage>
  )
}

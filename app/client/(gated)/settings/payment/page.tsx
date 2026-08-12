// app/client/(gated)/settings/payment/page.tsx
//
// iOS: ClientSettingsHubView → "Payment methods" → PaymentMethodsView.
//
// Gated by ENABLE_NO_SHOW_PROTECTION exactly like the hub row that links here —
// otherwise the flag would hide the row and leave the route reachable by URL,
// which is the same "a page with no way in" problem in reverse.
import { notFound } from 'next/navigation'

import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'

import ClientPage from '../../_components/ClientPage'
import ClientPaymentMethodsSettings from '../ClientPaymentMethodsSettings'

export const dynamic = 'force-dynamic'

export default function ClientPaymentSettingsPage() {
  if (!noShowProtectionEnabled()) notFound()

  return (
    <ClientPage
      eyebrow="Settings"
      title="Payment methods"
      lede="Save a card so a pro can charge a no-show or late-cancellation fee per their booking policy. You stay in control and can remove a card anytime."
      back={{ href: '/client/settings', label: 'Settings' }}
    >
      <section className="brand-glass p-5 sm:p-6">
        <ClientPaymentMethodsSettings />
      </section>
    </ClientPage>
  )
}

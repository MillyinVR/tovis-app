// app/client/(gated)/settings/page.tsx
//
// The client settings HUB.
//
// This page used to inline every panel: profile, personalization, public
// profile, discovery location, saved addresses, payment methods, chart
// sharing, notification preferences and account deletion, all on one route.
// At 390px that measured 11,847px of scroll with no way to jump — a client
// looking for quiet hours scrolled past their own home address to find it.
//
// iOS never worked that way: ClientSettingsHubView is a list of
// NavigationLink rows. This is the same screen, and the sub-routes are the
// same set in the same order, so the two platforms can be reasoned about
// together.
//
// ⚠️ Links minted before the split (`/client/settings#chart-sharing`, stored on
// already-sent notification rows — see lib/notifications/chartAccessNotifications.ts)
// still arrive here with a fragment. The rows carry those ids so an old link
// scrolls to the right row rather than dumping the client at the top.
import {
  AtSign,
  Bell,
  CreditCard,
  Eye,
  MapPin,
  Search,
  Sparkles,
  Trash2,
  UserCircle,
} from 'lucide-react'

import ThemeToggle from '@/lib/brand/ThemeToggle'
import { getBrandForTenantContext } from '@/lib/brand/forTenant'
import { resolveTenantContextForLayout } from '@/lib/tenant/layoutContext'
import { noShowProtectionEnabled } from '@/lib/noShowProtection/flag'

import ClientPage from '../_components/ClientPage'
import SettingsRow from './_components/SettingsRow'

export const dynamic = 'force-dynamic'

export default async function ClientSettingsPage() {
  const brand = getBrandForTenantContext(await resolveTenantContextForLayout())
  const showPaymentMethods = noShowProtectionEnabled()

  return (
    <ClientPage
      eyebrow="Settings"
      title="Your account"
      back={{ href: '/client/me', label: 'Me' }}
    >
      <div className="flex flex-col gap-7">
        <section className="flex flex-col gap-2.5">
          <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-textMuted">
            Account
          </h2>

          <SettingsRow
            href="/client/settings/profile"
            icon={UserCircle}
            title="Edit profile"
            subtitle="Name, phone, birthday & avatar"
          />
          <SettingsRow
            href="/client/settings/matches"
            icon={Sparkles}
            title="Better matches"
            subtitle="Hair, skin & what you’re into"
          />
          <SettingsRow
            href="/client/settings/public-profile"
            icon={AtSign}
            title="Public profile"
            subtitle="Handle, bio & public looks"
          />
          <SettingsRow
            href="/client/settings/addresses"
            icon={MapPin}
            title="Saved addresses"
            subtitle="Addresses for at-home service"
          />
          <SettingsRow
            href="/client/settings/location"
            icon={Search}
            title="Discovery location"
            subtitle="Where you search for pros"
          />
          {showPaymentMethods ? (
            <SettingsRow
              href="/client/settings/payment"
              icon={CreditCard}
              title="Payment methods"
              subtitle="Saved cards for no-show fees"
              legacyAnchorId="payment-methods"
            />
          ) : null}
          <SettingsRow
            href="/client/settings/chart-sharing"
            icon={Eye}
            title="Who can see your chart"
            subtitle="Allergies, formulas & notes your pro keeps"
            legacyAnchorId="chart-sharing"
          />
          <SettingsRow
            href="/client/settings/notifications"
            icon={Bell}
            title="Notifications"
            subtitle="Channels & quiet hours"
            legacyAnchorId="notifications"
          />
          {/*
            App Store guideline 5.1.1(v) requires account deletion to be
            reachable from the app, not buried behind a support request.
          */}
          <SettingsRow
            href="/client/settings/account"
            icon={Trash2}
            title="Delete account"
            subtitle="Close your account & remove your details"
          />
        </section>

        <section className="flex flex-col gap-2.5">
          <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-textMuted">
            Appearance
          </h2>

          <div className="flex flex-col gap-3 rounded-card border border-textPrimary/10 bg-bgSecondary/60 px-4 py-4">
            <p className="text-[12px] leading-snug text-textSecondary">
              Choose how {brand.displayName} looks. System follows your device’s
              light or dark setting.
            </p>
            <ThemeToggle />
          </div>
        </section>
      </div>
    </ClientPage>
  )
}

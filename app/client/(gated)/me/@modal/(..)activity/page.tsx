// app/client/me/@modal/(..)activity/page.tsx
//
// Intercepts /client/activity when it is opened FROM /client/me — i.e. from the
// bell in the Me header, which is the only entry point to it on web.
//
// Tori (2026-08-17): *"the pop up and done buttons on the iOS version so it
// feels like its an overview not a full page"*. iOS presents ClientActivityView
// as a sheet with Done; this is the web half of that parity.
//
// 🔴 The standalone route at app/client/(gated)/activity/page.tsx STAYS. An
// intercepting route only fires on a client-side navigation from a page whose
// layout carries this slot — a deep link, a push-notification tap, a refresh or
// a shared URL all render the real page. Deleting it would turn every one of
// those into a 404, which is exactly the shape of the client-side-404 trap this
// codebase has already been bitten by.
import { zClass } from '@/lib/zIndex'

import { loadClientActivityPage } from '@/app/client/(gated)/activity/_data/loadClientActivityPage'
import DismissModalButton from '../_components/DismissModalButton'
import ClientActivitySheet from '../_components/ClientActivitySheet'

export const dynamic = 'force-dynamic'

export default async function ClientActivityModalPage() {
  // The same loader the full page uses — one query shape, one auth redirect.
  const data = await loadClientActivityPage()

  return (
    <div className={`fixed inset-0 ${zClass.modal}`}>
      <DismissModalButton
        ariaLabel="Close activity"
        // `scrim` is a tint token: it is only ever painted WITH an alpha.
        // Solid, it fills the entire viewport.
        className="absolute inset-0 bg-scrim/70 backdrop-blur-[2px]"
      />

      <div className="pointer-events-none relative z-10 flex min-h-full items-end justify-center px-4 pb-2 pt-2 sm:items-center sm:p-4">
        <div
          className="
            pointer-events-auto flex w-full max-w-lg flex-col
            rounded-card border border-textPrimary/10 bg-bgSecondary
            shadow-[0_24px_80px_rgb(var(--shadow-color)/0.22)]
            h-[min(760px,calc(100dvh-0.5rem))]
            overflow-hidden
          "
        >
          <ClientActivitySheet
            items={data.items}
            unreadCount={data.unreadCount}
            markReadEventKeys={data.markReadEventKeys}
            trend={data.trend}
            credit={data.credit}
          />
        </div>
      </div>
    </div>
  )
}

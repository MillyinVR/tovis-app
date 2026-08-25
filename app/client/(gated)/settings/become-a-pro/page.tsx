// app/client/(gated)/settings/become-a-pro/page.tsx
//
// "Offer services" — the entry point item 60 was missing. The API door
// (POST /api/v1/pro/upgrade) merged in #987 and has shipped DARK since: no
// caller anywhere in the tree. This page and the hub row that links to it are
// the caller.
//
// The gated layout above has already refused anyone who is not an ACTIVE,
// fully-verified client, so the only question left for this page is the one it
// cannot answer: does this person already have a professional profile? The
// upgrade route answers 409 ALREADY_PRO for them, so rendering the form would
// be handing them a button that cannot work.
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'

import ClientPage from '../../_components/ClientPage'
import BecomeProClient from './BecomeProClient'

export const dynamic = 'force-dynamic'

const SETTINGS_HREF = '/client/settings'

export default async function ClientBecomeProPage() {
  const user = await getCurrentUser().catch(() => null)

  // Defensive only — the layout redirects first. Without it this file would
  // have to reason about a null user in the branch below.
  if (!user) redirect(SETTINGS_HREF)

  if (user.professionalProfile) {
    // Not a link to /pro: the pro shell refuses an acting role that is not
    // PRO, so a link would bounce them to a login screen they are already past.
    // The workspace switcher is the control that actually moves them, and it
    // is mounted globally — so point at it rather than inventing a second one.
    return (
      <ClientPage
        eyebrow="Settings"
        title="You already offer services"
        lede="This account already has a pro workspace, so there is nothing to set up."
        back={{ href: SETTINGS_HREF, label: 'Settings' }}
      >
        <section className="brand-glass p-5 sm:p-6">
          <p className="text-[14px] leading-relaxed text-textSecondary">
            Use the workspace switcher in the top-right corner to move between
            your client account and your Pro studio. Your bookings, boards and
            chart stay where they are either way.
          </p>
        </section>
      </ClientPage>
    )
  }

  return (
    <ClientPage
      eyebrow="Settings"
      title="Offer services"
      lede="Add a pro workspace to this account — take bookings, run a calendar and get paid. Your client account stays yours; switch between the two whenever you like."
      back={{ href: SETTINGS_HREF, label: 'Settings' }}
    >
      <section className="brand-glass p-5 sm:p-6">
        <BecomeProClient />
      </section>
    </ClientPage>
  )
}

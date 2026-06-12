// app/pro/onboarding/page.tsx
//
// Setup checklist for unready pros. The onboarding gate redirects here
// (or to a specific fix-it page) whenever a pro with readiness blockers
// hits a gated /pro path, so this page must always exist and must only
// link to pages on the gate's unready allowlist.

import Link from 'next/link'
import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/currentUser'
import { PRO_BLOCKER_COPY } from '@/lib/pro/readiness/blockerCopy'
import { checkProReadiness } from '@/lib/pro/readiness/proReadiness'

export const dynamic = 'force-dynamic'

const PRO_HOME = '/pro/calendar'

export default async function ProOnboardingPage() {
  const user = await getCurrentUser()

  if (!user || user.role !== 'PRO' || !user.professionalProfile) {
    redirect('/login?from=/pro/onboarding')
  }

  const readiness = await checkProReadiness(user.professionalProfile.id)

  if (readiness.ok) {
    redirect(PRO_HOME)
  }

  const items = readiness.blockers
    .map((blocker) => PRO_BLOCKER_COPY[blocker])
    .filter(Boolean)

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-4 px-4 py-6">
      <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-5">
        <div className="text-[12px] font-black uppercase tracking-wide text-textSecondary">
          Finish setup
        </div>

        <h1 className="mt-1 text-[20px] font-black text-textPrimary">
          You’re almost bookable
        </h1>

        <p className="mt-2 text-[13px] font-semibold text-textSecondary">
          Clients can’t book you until these setup items are done. Knock them
          out in any order — each one links straight to the right page.
        </p>
      </div>

      <div className="grid gap-2">
        {items.map((item, index) => (
          <Link
            key={`${item.href}:${item.label}`}
            href={item.href}
            className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4 transition hover:border-toneWarn/50"
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-toneWarn/35 bg-toneWarn/10 text-[12px] font-black text-toneWarn">
                {index + 1}
              </span>

              <div className="min-w-0">
                <div className="text-[13px] font-black text-textPrimary">
                  {item.label}
                </div>
                <div className="mt-0.5 text-[12px] font-semibold text-textSecondary">
                  {item.href}
                </div>
              </div>

              <span
                className="ml-auto text-[16px] font-black text-textSecondary"
                aria-hidden="true"
              >
                →
              </span>
            </div>
          </Link>
        ))}
      </div>

      <div className="text-[12px] font-semibold text-textSecondary">
        Once everything is done you’ll land back on your calendar
        automatically.
      </div>
    </div>
  )
}

// app/pro/account/delete/page.tsx
//
// The pro's Delete Account screen, reached from the Account group in the pro
// profile's account section. It renders the SAME panel as client settings —
// the deletion contract and its copy live in one place.

import Link from 'next/link'

import DeleteAccountPanel from '@/app/_components/account/DeleteAccountPanel'

export const dynamic = 'force-dynamic'

export default function ProDeleteAccountPage() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
      <div>
        <Link
          href="/pro/profile/public-profile"
          className="text-xs font-black uppercase tracking-[var(--ls-caps)] text-textSecondary hover:text-textPrimary"
        >
          ‹ Back to profile
        </Link>
      </div>

      <DeleteAccountPanel />
    </div>
  )
}

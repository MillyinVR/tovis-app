// app/nfc/invalid/page.tsx
import Link from 'next/link'

import PublicTopBar from '@/app/_components/PublicTopBar/PublicTopBar'

export default function NfcInvalidPage() {
  return (
    <main className="min-h-screen w-full text-textPrimary">
      <PublicTopBar />

      <div className="mx-auto w-full max-w-2xl px-6 pb-20 sm:px-10">
        <header className="mb-10 mt-2">
          <div className="tovis-section-label mb-4">NFC card</div>
          <h1 className="font-display text-[36px] font-semibold leading-tight tracking-tight">
            This card isn&rsquo;t active
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-textSecondary">
            The NFC card you tapped is invalid or has been deactivated. If you
            think this is a mistake, reach out to the professional who gave you
            the card, or contact support.
          </p>
        </header>

        <div className="flex flex-wrap gap-4 text-[14px]">
          <Link
            href="/"
            className="font-semibold text-accentPrimary underline-offset-2 transition hover:underline"
          >
            Go to the homepage
          </Link>
          <Link
            href="/support"
            className="font-semibold text-accentPrimary underline-offset-2 transition hover:underline"
          >
            Contact support
          </Link>
        </div>
      </div>
    </main>
  )
}

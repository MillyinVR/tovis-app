// app/nfc/invalid/page.tsx
import Link from 'next/link'

import PublicTopBar from '@/app/_components/PublicTopBar/PublicTopBar'

type NfcErrorReason = 'invalid' | 'rate' | 'unavailable'

function parseReason(raw: string | string[] | undefined): NfcErrorReason {
  const value = Array.isArray(raw) ? raw[0] : raw
  if (value === 'rate' || value === 'unavailable') return value
  return 'invalid'
}

const COPY: Record<NfcErrorReason, { title: string; body: string }> = {
  invalid: {
    title: 'This card isn’t active',
    body: 'The NFC card you tapped is invalid or has been deactivated. If you think this is a mistake, reach out to the professional who gave you the card, or contact support.',
  },
  rate: {
    title: 'One moment',
    body: 'That was a lot of taps in a short window. Please wait a few moments and tap your card again.',
  },
  unavailable: {
    title: 'Not taking bookings yet',
    body: 'This card is linked to a professional who isn’t available for booking right now. Check back soon, or reach out to them directly.',
  },
}

export default async function NfcInvalidPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const searchParams = (await props.searchParams) ?? {}
  const reason = parseReason(searchParams.reason)
  const copy = COPY[reason]

  return (
    <main className="min-h-screen w-full text-textPrimary">
      <PublicTopBar />

      <div className="mx-auto w-full max-w-2xl px-6 pb-20 sm:px-10">
        <header className="mb-10 mt-2">
          <div className="tovis-section-label mb-4">NFC card</div>
          <h1 className="font-display text-[36px] font-semibold leading-tight tracking-tight">
            {copy.title}
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-textSecondary">
            {copy.body}
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

'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'
import { getBrandConfig } from '@/lib/brand'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const brand = getBrandConfig()

  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body className="bg-bgPrimary text-textPrimary">
        <main className="mx-auto flex min-h-screen max-w-720px flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className="text-2xl font-black">{brand.displayName} hit an unexpected error.</h1>
          <p className="text-sm text-textSecondary">
            The error was reported. Try again once. If it keeps happening, treat
            it like a real incident instead of pretending the app is fine.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-full border border-white/10 bg-bgSecondary px-4 py-2 text-sm font-black"
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  )
}
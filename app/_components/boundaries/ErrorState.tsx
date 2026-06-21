'use client'

// Shared error-boundary UI for the app's route-segment error.tsx files.
// White-label safe: brand tokens + tone utilities only, brand name resolved
// from lib/brand (never hardcoded). Each error.tsx is a thin wrapper that
// passes Next's { error, reset } through plus area-specific copy/links.
import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import Link from 'next/link'
import { getBrandConfig } from '@/lib/brand'

type ErrorStateProps = {
  error: Error & { digest?: string }
  reset: () => void
  /** Headline override. Defaults to a brand-named line. */
  title?: string
  /** Body copy override. */
  description?: string
  /** Optional secondary link back into the area (e.g. its home). */
  homeHref?: string
  homeLabel?: string
}

export default function ErrorState({
  error,
  reset,
  title,
  description,
  homeHref,
  homeLabel,
}: ErrorStateProps) {
  const brand = getBrandConfig()

  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-toneDanger">
        Something broke
      </div>

      <h1 className="text-2xl font-black text-textPrimary">
        {title ?? `${brand.displayName} hit a snag.`}
      </h1>

      <p className="text-sm text-textSecondary">
        {description ??
          'The error was reported. Try again — if it keeps happening, treat it like a real issue, not a fluke.'}
      </p>

      {error.digest ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-textMuted">
          Ref {error.digest}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="brand-focus rounded-full border border-accentPrimary/30 bg-accentPrimary/10 px-4 py-2 text-sm font-black text-accentPrimary transition hover:bg-accentPrimary/16"
        >
          Try again
        </button>

        {homeHref ? (
          <Link
            href={homeHref}
            className="brand-focus rounded-full border border-surfaceGlass/14 bg-bgSecondary px-4 py-2 text-sm font-black text-textPrimary transition hover:border-surfaceGlass/22"
          >
            {homeLabel ?? 'Go back'}
          </Link>
        ) : null}
      </div>
    </main>
  )
}

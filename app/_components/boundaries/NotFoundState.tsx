// Shared not-found UI for the app's route-segment not-found.tsx files.
// White-label safe: brand tokens + tone utilities only, brand name resolved
// from lib/brand. Server component (no client JS) — each not-found.tsx is a
// thin wrapper that passes area-specific copy + a link back into the area.
import Link from 'next/link'
import { getBrandConfig } from '@/lib/brand'

type NotFoundStateProps = {
  /** Headline override. */
  title?: string
  /** Body copy override. */
  description?: string
  /** Link back into the area. Defaults to the app home. */
  homeHref?: string
  homeLabel?: string
}

export default function NotFoundState({
  title,
  description,
  homeHref = '/',
  homeLabel = 'Back to home',
}: NotFoundStateProps) {
  const brand = getBrandConfig()

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-toneInfo">
        404 — Not found
      </div>

      <h1 className="text-2xl font-black text-textPrimary">
        {title ?? 'This page isn’t here.'}
      </h1>

      <p className="text-sm text-textSecondary">
        {description ??
          `The link may be broken or the page may have moved. The rest of ${brand.displayName} is still here.`}
      </p>

      <Link
        href={homeHref}
        className="brand-focus mt-2 rounded-full border border-accentPrimary/30 bg-accentPrimary/10 px-4 py-2 text-sm font-black text-accentPrimary transition hover:bg-accentPrimary/16"
      >
        {homeLabel}
      </Link>
    </main>
  )
}

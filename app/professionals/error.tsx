'use client'

import ErrorState from '@/app/_components/boundaries/ErrorState'

// See not-found.tsx: /professionals has no page.tsx, so "Browse pros" goes to
// /search — the app's established browse-pros destination.
export default function ProfessionalsError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorState {...props} homeHref="/search" homeLabel="Browse pros" />
}

'use client'

import ErrorState from '@/app/_components/boundaries/ErrorState'

export default function GlobalRouteError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorState {...props} homeHref="/" homeLabel="Back to home" />
}

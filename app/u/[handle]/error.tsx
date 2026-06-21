'use client'

import ErrorState from '@/app/_components/boundaries/ErrorState'

export default function PublicProfileError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorState {...props} homeHref="/" homeLabel="Back to home" />
}

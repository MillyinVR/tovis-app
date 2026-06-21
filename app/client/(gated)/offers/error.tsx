'use client'

import ErrorState from '@/app/_components/boundaries/ErrorState'

export default function ClientOffersError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorState {...props} homeHref="/client" homeLabel="Home" />
}

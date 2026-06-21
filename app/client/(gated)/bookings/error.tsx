'use client'

import ErrorState from '@/app/_components/boundaries/ErrorState'

export default function ClientBookingsError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorState {...props} homeHref="/client" homeLabel="Home" />
}

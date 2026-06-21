'use client'

import ErrorState from '@/app/_components/boundaries/ErrorState'

export default function ProError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState {...props} homeHref="/pro/dashboard" homeLabel="Pro dashboard" />
  )
}

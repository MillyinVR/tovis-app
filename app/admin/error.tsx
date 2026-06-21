'use client'

import ErrorState from '@/app/_components/boundaries/ErrorState'

export default function AdminError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorState {...props} homeHref="/admin" homeLabel="Admin home" />
}

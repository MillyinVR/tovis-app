'use client'

import ErrorState from '@/app/_components/boundaries/ErrorState'

export default function MessagesError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState {...props} homeHref="/messages" homeLabel="Back to messages" />
  )
}

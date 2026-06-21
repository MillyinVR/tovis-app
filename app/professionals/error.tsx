'use client'

import ErrorState from '@/app/_components/boundaries/ErrorState'

export default function ProfessionalsError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorState {...props} homeHref="/professionals" homeLabel="Browse pros" />
  )
}

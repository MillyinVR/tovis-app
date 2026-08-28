'use client'

import ErrorState from '@/app/_components/boundaries/ErrorState'
import { useErrorHome } from '@/app/_components/boundaries/ErrorHomeProvider'

export default function GlobalRouteError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // Role-aware, same as the root not-found: a signed-in client who trips an
  // error anywhere outside /client used to be sent to the public marketing hero.
  const home = useErrorHome()

  return <ErrorState {...props} homeHref={home.href} homeLabel={home.label} />
}

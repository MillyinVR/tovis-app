'use client'

import ErrorState from '@/app/_components/boundaries/ErrorState'
import { useErrorHome } from '@/app/_components/boundaries/ErrorHomeProvider'

export default function PublicProfileError(props: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  // /u/[handle] is linked from the client home's follow suggestions and the
  // client "me" dashboard, so the viewer here is very often a signed-in client.
  const home = useErrorHome()

  return <ErrorState {...props} homeHref={home.href} homeLabel={home.label} />
}

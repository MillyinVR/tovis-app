import NotFoundState from '@/app/_components/boundaries/NotFoundState'
import { resolveErrorHome } from '@/app/_components/boundaries/errorHomeHref'

// Reading the session cookie to point "Home" at the viewer's own home makes this
// dynamic — matching app/not-found.tsx. The profile page itself is already
// force-dynamic, so this costs the route nothing it wasn't already paying.
export const dynamic = 'force-dynamic'

export default async function PublicProfileNotFound() {
  const home = await resolveErrorHome()

  return (
    <NotFoundState
      title="That profile isn’t here."
      description="This handle may be unclaimed, private, or have changed."
      homeHref={home.href}
      homeLabel={home.label}
    />
  )
}

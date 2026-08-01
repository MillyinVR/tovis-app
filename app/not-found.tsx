import NotFoundState from '@/app/_components/boundaries/NotFoundState'
import { resolveErrorHome } from '@/app/_components/boundaries/errorHomeHref'

// Reading the session cookie to point "Home" at the viewer's own home makes this
// route dynamic. Without it, a signed-in client who mistypes a URL is thrown out
// to the public marketing hero with no way back in (see errorHomeHref).
export const dynamic = 'force-dynamic'

export default async function GlobalNotFound() {
  const home = await resolveErrorHome()

  return <NotFoundState homeHref={home.href} homeLabel={home.label} />
}

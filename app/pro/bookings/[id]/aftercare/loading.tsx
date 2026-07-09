// Branded fallback while the aftercare page's server work resolves — the booking
// query plus signing every before/after image. This is a force-dynamic route
// with no cache, so a slow or cross-region load previously showed a blank screen
// with no sign of progress; the splash makes it clear the page is working.
import BrandLoader from '@/lib/brand/BrandLoader'

export default function Loading() {
  return <BrandLoader variant="inline" caption="Loading aftercare" />
}

// Branded fallback while the pro profile's server fetch resolves, so a slow
// load shows the splash instead of a blank screen.
import BrandLoader from '@/lib/brand/BrandLoader'

export default function Loading() {
  return <BrandLoader variant="inline" />
}

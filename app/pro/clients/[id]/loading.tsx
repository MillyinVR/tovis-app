// Branded fallback while the client chart's server work resolves.
//
// This is a force-dynamic route with no cache, and applying a visits filter is a
// navigation, not an in-memory array pass — the Status / "Only with me" controls
// now submit `?status=` / `?withMe=`, which run a real Prisma query, and the
// visits view additionally signs a URL per before/after frame. Without a
// boundary here the pro would sit on the previous render with no sign of
// progress. Mirrors app/pro/bookings/[id]/aftercare/loading.tsx.
import BrandLoader from '@/lib/brand/BrandLoader'

export default function Loading() {
  return <BrandLoader variant="inline" caption="Loading chart" />
}

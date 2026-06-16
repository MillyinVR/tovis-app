// app/client/(gated)/openings/page.tsx
// Client-facing last-minute openings feed. Auth is enforced by the (gated) layout; the data
// is loaded client-side from GET /api/client/openings. Each card links to the claim page.
import OpeningsFeedClient from './OpeningsFeedClient'

export const dynamic = 'force-dynamic'

export default function ClientOpeningsFeedPage() {
  return <OpeningsFeedClient />
}

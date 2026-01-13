// app/looks/page.tsx (or app/(main)/looks/page.tsx)
import LooksFeed from './_components/LooksFeed'

export const dynamic = 'force-dynamic'

export default function LooksPage() {
  return (
    <main className="bg-bgPrimary" style={{ height: '100dvh', overflow: 'hidden' }}>
      <LooksFeed />
    </main>
  )
}

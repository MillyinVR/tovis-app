// app/looks/page.tsx (or app/(main)/looks/page.tsx)
import LooksFeed from './LooksFeed'

export const dynamic = 'force-dynamic'

export default function LooksPage() {
  return (
    <main
      style={{
        height: '100dvh',
        overflow: 'hidden', // ✅ page never scrolls
        background: '#000',
      }}
    >
      <LooksFeed />
    </main>
  )
}

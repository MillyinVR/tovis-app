// app/looks/page.tsx (or app/(main)/looks/page.tsx)
import LooksFeed from './_components/LooksFeed'

export const dynamic = 'force-dynamic'

export default function LooksPage() {
  // Media stays dark in both themes (brand sheet: the feed stays dark, only
  // the chrome flips). data-mode pins the dark tokens for this subtree.
  return (
    <main
      data-mode="dark"
      className="bg-bgPrimary"
      style={{ height: '100dvh', overflow: 'hidden', colorScheme: 'dark' }}
    >
      <LooksFeed />
    </main>
  )
}

// app/client/(gated)/activity/page.tsx
import ClientActivityFrame from './ClientActivityFrame'
import { loadClientActivityPage } from './_data/loadClientActivityPage'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Activity',
}

export default async function ClientActivityPage() {
  const data = await loadClientActivityPage()

  return (
    <main className="h-[calc(100dvh-4.5rem-env(safe-area-inset-bottom))] overflow-hidden">
      <ClientActivityFrame
        items={data.items}
        unreadCount={data.unreadCount}
        markReadEventKeys={data.markReadEventKeys}
      />
    </main>
  )
}

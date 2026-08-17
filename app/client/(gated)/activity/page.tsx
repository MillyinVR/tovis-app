// app/client/(gated)/activity/page.tsx
import ClientActivityFrame from './ClientActivityFrame'
import { loadClientActivityPage } from './_data/loadClientActivityPage'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Activity',
}

export default async function ClientActivityPage() {
  const data = await loadClientActivityPage()

  // The frame mounts <ClientPage> itself: "Mark all read" is a stateful control
  // that has to live inside the client component, and it belongs in the header.
  return (
    <ClientActivityFrame
      items={data.items}
      unreadCount={data.unreadCount}
      markReadEventKeys={data.markReadEventKeys}
      trend={data.trend}
      credit={data.credit}
    />
  )
}

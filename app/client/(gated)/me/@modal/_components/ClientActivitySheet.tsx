'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'

import ClientActivityFrame from '@/app/client/(gated)/activity/ClientActivityFrame'
import type { ClientActivityItem } from '@/lib/notifications/activityFeed'

/**
 * The Me bell's Activity overview, presented as a sheet.
 *
 * Thin on purpose: it exists only to turn "dismiss" into a callback the shared
 * `ClientActivityFrame` can render as a Done button. The feed itself — rows,
 * icons, follow-back, the optimistic mark-all-read — is the SAME component the
 * standalone `/client/activity` page renders, so the sheet and the page cannot
 * drift.
 *
 * Dismissal mirrors `DismissModalButton`: step back through history when there
 * is history to step back through, otherwise push /client/me. Landing on the
 * intercepted URL with no history (a cold open of the deep link) renders the
 * full PAGE instead of this, so the fallback is only for the odd case where an
 * interception happened without a navigable entry behind it.
 */
export default function ClientActivitySheet({
  items,
  unreadCount,
  markReadEventKeys,
}: {
  items: ClientActivityItem[]
  unreadCount: number
  markReadEventKeys: string[]
}) {
  const router = useRouter()

  const onDone = useCallback(() => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back()
      return
    }
    router.push('/client/me')
  }, [router])

  return (
    <ClientActivityFrame
      items={items}
      unreadCount={unreadCount}
      markReadEventKeys={markReadEventKeys}
      presentation="sheet"
      onDone={onDone}
    />
  )
}

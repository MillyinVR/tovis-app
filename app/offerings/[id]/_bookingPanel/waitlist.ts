// app/offerings/[id]/_bookingPanel/waitlist.ts

import type { WaitlistPayload } from './types'
import { safeJson } from './api'

export async function postWaitlist(payload: WaitlistPayload) {
  const res = await fetch('/api/waitlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await safeJson(res)
  if (!res.ok) throw new Error(data?.error || `Failed to join waitlist (${res.status}).`)
  return data
}

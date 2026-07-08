// lib/messages/paging.ts
//
// Shared cursor-paging math for a thread's message history. Used by the SSR
// thread page (initial newest page), the GET /messages/threads/[id] route (the
// cursor fetch ThreadClient calls for "load earlier"), and the iOS client, so
// the initial cursor lines up with every subsequent page.

/**
 * How many messages a single thread page holds — the SSR initial load AND each
 * "load earlier" cursor fetch. Keeping both on one number means the cursor the
 * SSR page hands the client points at the exact boundary the route pages from.
 */
export const THREAD_MESSAGE_PAGE_SIZE = 40

/**
 * The cursor for the next-OLDER page, given a DESC page of message ids
 * (newest → oldest) that was fetched with `pageSize`. The cursor is the oldest
 * id in the page, present only when the page was full — a partial page means we
 * reached the start of history, so there is nothing older to load.
 */
export function nextOlderCursor(
  descIds: readonly string[],
  pageSize: number,
): string | null {
  if (descIds.length < pageSize) return null
  return descIds[descIds.length - 1] ?? null
}

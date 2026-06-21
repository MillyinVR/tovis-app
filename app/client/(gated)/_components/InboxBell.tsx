// app/client/(gated)/_components/InboxBell.tsx
'use client'

import Link from 'next/link'

import { useUnreadBadge } from '@/app/_components/_hooks/useUnreadBadge'

/**
 * Client home-header inbox entry point. Links to the shared messaging inbox
 * (/messages) — the same surface the footer Inbox tab and the pro header use.
 * The dot reflects real unread message threads via useUnreadBadge (the exact
 * source the footer badge reads), so it is never decorative.
 */
export default function InboxBell() {
  const badge = useUnreadBadge()

  return (
    <Link
      href="/messages"
      aria-label="Inbox"
      className="relative grid h-[38px] w-[38px] shrink-0 place-items-center rounded-full border border-textPrimary/16 text-textMuted transition hover:border-textPrimary/25 hover:text-textSecondary"
    >
      <svg width="16" height="18" viewBox="0 0 15 17" fill="none">
        <path
          d="M7.5 1a5 5 0 0 1 5 5c0 2.5.5 4 1.5 5H1c1-1 1.5-2.5 1.5-5a5 5 0 0 1 5-5Z"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
        <path
          d="M6 11.5a1.5 1.5 0 0 0 3 0"
          stroke="currentColor"
          strokeWidth="1.3"
          strokeLinecap="round"
        />
      </svg>
      {badge ? (
        <span className="absolute right-2 top-[7px] h-[7px] w-[7px] rounded-full border-[1.5px] border-bgPrimary bg-gold" />
      ) : null}
    </Link>
  )
}

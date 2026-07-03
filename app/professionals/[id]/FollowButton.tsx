// app/professionals/[id]/FollowButton.tsx
'use client'

import { useCallback } from 'react'
import { useRouter } from 'next/navigation'

import { useProFollow } from '@/app/(main)/looks/_components/useProFollow'
import { formatFollowerLabel } from '@/lib/profiles/publicProfileFormatting'

type FollowButtonProps = {
  professionalId: string
  // Server-rendered ProFollow count, shown until the hook hydrates the
  // viewer's own follow state (guests keep this value).
  initialFollowerCount: number
  // Local path to return to after a guest signs in to follow.
  fromPath: string
}

/**
 * Follow pill + follower count for the public pro profile hero. Reuses the
 * feed's follow hook and `/api/v1/pros/[id]/follow` endpoint, so following
 * here feeds the same Following tab and notifications as the Looks feed.
 */
export default function FollowButton({
  professionalId,
  initialFollowerCount,
  fromPath,
}: FollowButtonProps) {
  const router = useRouter()

  const onRequireAuth = useCallback(
    (reason: string) => {
      const qs = new URLSearchParams({ from: fromPath, reason })
      router.push(`/login?${qs.toString()}`)
    },
    [fromPath, router],
  )

  const { following, followerCount, ready, toggle } = useProFollow({
    professionalId,
    onRequireAuth,
  })

  const displayCount = ready ? followerCount : initialFollowerCount

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={following}
        aria-label={following ? 'Unfollow this pro' : 'Follow this pro'}
        onClick={() => toggle()}
        className={[
          'brand-focus inline-flex shrink-0 items-center rounded-full border px-4 py-1.5',
          'font-mono text-[11px] font-bold uppercase tracking-[0.06em] transition',
          following
            ? 'border-[rgb(var(--surface-glass)/0.35)] bg-[rgb(var(--surface-glass)/0.12)] text-textPrimary/70 hover:text-textPrimary'
            : 'border-[rgb(var(--accent-primary)/0.4)] bg-[rgb(var(--accent-primary)/0.1)] text-textPrimary hover:border-[rgb(var(--accent-primary)/0.6)]',
        ].join(' ')}
      >
        {following ? 'Following' : 'Follow'}
      </button>

      {displayCount > 0 ? (
        <span className="font-mono text-[11px] font-semibold text-textSecondary">
          {formatFollowerLabel(displayCount)}
        </span>
      ) : null}
    </div>
  )
}

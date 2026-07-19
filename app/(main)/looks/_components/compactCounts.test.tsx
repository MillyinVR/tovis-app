// app/(main)/looks/_components/compactCounts.test.tsx
//
// Characterization + parity tests for compact-count rendering on the two looks
// surfaces (round-3 queue item 12).
//
// Both components used to carry their own private `formatCount()`, each drifting
// from the canonical `formatCompactCount` a different way. Captured by running
// these tests RED against the pre-consolidation code:
//
//   value     canonical   RightActionRail (was)   CommentsDrawer (was)
//   1_000     1K          1000                    1.0K
//   1_500     1.5K        1500                    1.5K
//   9_999     10K         9999                    10.0K
//   100_500   100.5K      101K                    100.5K
//   999_999   1M          1000K                   1000.0K
//   1_200_000 1.2M        1000K  (clamped!)       1.2M
//
// The rail additionally clamped at 999_999, so a genuinely viral look reported
// "1000K" forever. These tests pin the canonical output at each surface so the
// drift cannot come back.
import { ProNameDisplay } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode
    href: string
  }) => <a href={href}>{children}</a>,
}))

vi.mock('@/app/_components/media/RemoteImage', () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}))

const mocks = vi.hoisted(() => ({ useLookComments: vi.fn() }))

vi.mock('./useLookComments', () => ({
  useLookComments: mocks.useLookComments,
}))

import RightActionRail from './RightActionRail'
import CommentsDrawer from './CommentsDrawer'

const PRO = {
  id: 'pro_1',
  businessName: 'TOVIS Studio',
  firstName: 'Tori',
  lastName: 'Morales',
  nameDisplay: ProNameDisplay.BUSINESS_NAME,
  avatarUrl: null,
}

function renderRail(likeCount: number) {
  return render(
    <RightActionRail
      lookPostId="look_1"
      pro={PRO}
      viewerLiked={false}
      likeCount={likeCount}
      commentCount={0}
      onOpenAvailability={() => {}}
      onToggleLike={() => {}}
      onOpenComments={() => {}}
      onShare={() => {}}
    />,
  )
}

function renderDrawer(commentsCount: number) {
  mocks.useLookComments.mockReturnValue({
    comments: [],
    commentsCount,
    loading: false,
    error: null,
    text: '',
    setText: () => {},
    posting: false,
    replyTo: null,
    setReplyTo: () => {},
    getThread: () => ({ open: false, loading: false, items: [] }),
    toggleReplies: () => {},
    post: () => {},
    toggleLike: () => {},
    remove: () => {},
    report: () => {},
  })

  return render(
    <CommentsDrawer
      lookPostId="look_1"
      open
      onClose={() => {}}
      onCountChange={() => {}}
      onRequireAuth={() => {}}
    />,
  )
}

describe('compact counts render canonically across looks surfaces', () => {
  const CASES: ReadonlyArray<[number, string]> = [
    [999, '999'],
    [1_000, '1K'],
    [1_500, '1.5K'],
    [9_999, '10K'],
    [100_500, '100.5K'],
    [999_999, '1M'],
    [1_200_000, '1.2M'],
  ]

  describe('RightActionRail like count', () => {
    for (const [value, expected] of CASES) {
      it(`renders ${value} as ${expected}`, () => {
        const { unmount } = renderRail(value)
        expect(screen.getByText(expected)).toBeTruthy()
        unmount()
      })
    }
  })

  describe('CommentsDrawer header count', () => {
    for (const [value, expected] of CASES) {
      it(`renders ${value} as ${expected}`, () => {
        const { unmount } = renderDrawer(value)
        expect(screen.getByText(`${expected} comments`)).toBeTruthy()
        unmount()
      })
    }
  })
})

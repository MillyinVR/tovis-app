// app/_components/account/BlockedAccountsPanel.tsx
//
// "Blocked accounts" (App Store guideline 1.2). A block is durable and it is
// the user's own decision, so there has to be a place to see and lift it — a
// block with no way back is its own problem, not a safety feature.
//
// Lists only blocks the viewer MADE. Blocks RECEIVED also hide content (the
// read filter is symmetric), but showing them would tell the viewer who blocked
// them, which is exactly what a block exists to withhold — see
// lib/blocks/blockTargets.ts.

'use client'

import { useCallback, useEffect, useState } from 'react'

import RemoteImage from '@/app/_components/media/RemoteImage'
import Button from '@/app/_components/ui/Button'
import { isRecord } from '@/lib/guards'
import { readErrorMessage, safeJson } from '@/lib/http'

const ENDPOINT = '/api/v1/blocks'

type BlockedAccount = {
  blockId: string
  handle: string
  displayName: string
  avatarUrl: string | null
}

function parseBlocks(payload: unknown): BlockedAccount[] {
  if (!isRecord(payload) || !Array.isArray(payload.blocks)) return []

  const out: BlockedAccount[] = []
  for (const item of payload.blocks) {
    if (!isRecord(item)) continue
    const blockId = typeof item.blockId === 'string' ? item.blockId : null
    const displayName =
      typeof item.displayName === 'string' ? item.displayName : null
    // Without a blockId the row could not be lifted, which is the only thing
    // this list is for — so an unusable row is dropped rather than shown inert.
    if (!blockId || !displayName) continue
    out.push({
      blockId,
      displayName,
      handle: typeof item.handle === 'string' ? item.handle : '',
      avatarUrl: typeof item.avatarUrl === 'string' ? item.avatarUrl : null,
    })
  }
  return out
}

export default function BlockedAccountsPanel() {
  const [blocks, setBlocks] = useState<BlockedAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(ENDPOINT, { cache: 'no-store' })
      const body = await safeJson(res)
      if (!res.ok) {
        setError(readErrorMessage(body) ?? 'Something went wrong.')
        return
      }
      setBlocks(parseBlocks(body))
      setError(null)
    } catch {
      setError('Could not load your blocked accounts. Try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function unblock(blockId: string) {
    setBusyId(blockId)
    setError(null)
    try {
      const res = await fetch(`${ENDPOINT}/${encodeURIComponent(blockId)}`, {
        method: 'DELETE',
      })
      const body = await safeJson(res)
      if (!res.ok) {
        setError(readErrorMessage(body) ?? 'Something went wrong.')
        return
      }
      setBlocks((prev) => prev.filter((block) => block.blockId !== blockId))
    } catch {
      setError('Could not unblock this account. Try again.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) {
    return <div className="text-xs font-semibold text-textSecondary">Loading…</div>
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p role="alert" className="text-[12px] font-semibold text-toneDanger">
          {error}
        </p>
      ) : null}

      {blocks.length === 0 ? (
        <p className="text-[13px] leading-relaxed text-textSecondary">
          You haven’t blocked anyone. When you block someone, you won’t see
          their looks or comments and they won’t see yours.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {blocks.map((block) => (
            <li
              key={block.blockId}
              className="flex items-center gap-3 rounded-card border border-textPrimary/10 bg-bgSecondary/60 px-4 py-3"
            >
              {block.avatarUrl ? (
                <RemoteImage
                  src={block.avatarUrl}
                  alt=""
                  width={36}
                  height={36}
                  className="h-9 w-9 shrink-0 rounded-full object-cover"
                />
              ) : (
                <div
                  aria-hidden
                  className="h-9 w-9 shrink-0 rounded-full bg-surfaceGlass/10"
                />
              )}

              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-semibold text-textPrimary">
                  {block.displayName}
                </div>
                {block.handle && `@${block.handle}` !== block.displayName ? (
                  <div className="truncate text-[12px] text-textSecondary">
                    @{block.handle}
                  </div>
                ) : null}
              </div>

              <Button
                variant="neutral"
                size="sm"
                fill="soft"
                disabled={busyId === block.blockId}
                onClick={() => void unblock(block.blockId)}
              >
                {busyId === block.blockId ? 'Unblocking…' : 'Unblock'}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

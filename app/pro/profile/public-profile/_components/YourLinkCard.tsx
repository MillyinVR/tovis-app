// app/pro/profile/public-profile/_components/YourLinkCard.tsx
'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'

import ShareButton from '@/app/professionals/[id]/ShareButton'

const MEMBERSHIP_URL = '/pro/membership'

type YourLinkCardProps = {
  handle: string | null
  isApproved: boolean
  isPremium: boolean
  vanityHost: string | null
  vanityUrl: string | null
  vanityQrSvg: string | null
}

/**
 * The pro's "Your link" surface. One card, three states:
 *  - locked   → not approved yet (link unlocks after verification)
 *  - reserve  → approved but not premium (claim/reserve + upgrade to go live)
 *  - live     → approved + premium (copy / open / share / QR)
 * Handle *entry* still lives in the Edit profile modal (single source); this card
 * is about understanding state and using the link once it exists.
 */
export default function YourLinkCard({
  handle,
  isApproved,
  isPremium,
  vanityHost,
  vanityUrl,
  vanityQrSvg,
}: YourLinkCardProps) {
  const state: 'locked' | 'reserve' | 'live' = !isApproved
    ? 'locked'
    : isPremium && vanityUrl
      ? 'live'
      : 'reserve'

  return (
    <section className="brand-pro-profile-card">
      <div className="brand-pro-profile-service-title">Your link</div>

      {state === 'locked' ? (
        <LockedState />
      ) : state === 'reserve' ? (
        <ReserveState handle={handle} vanityHost={vanityHost} />
      ) : (
        <LiveState
          vanityHost={vanityHost}
          vanityUrl={vanityUrl}
          vanityQrSvg={vanityQrSvg}
        />
      )}
    </section>
  )
}

function LockedState() {
  return (
    <p className="mt-1 text-[12px] text-textSecondary">
      Your{' '}
      <span className="font-black text-textPrimary">.tovis.me</span> link unlocks
      once your account is verified. You can finish the rest of your profile in
      the meantime.
    </p>
  )
}

function ReserveState({
  handle,
  vanityHost,
}: {
  handle: string | null
  vanityHost: string | null
}) {
  return (
    <div className="mt-1 grid gap-3">
      {handle && vanityHost ? (
        <p className="text-[12px] text-textSecondary">
          You&apos;ve reserved{' '}
          <span className="font-black text-textPrimary">{vanityHost}</span>. It
          goes live the moment you upgrade.
        </p>
      ) : (
        <p className="text-[12px] text-textSecondary">
          Claim a custom link like{' '}
          <span className="font-black text-textPrimary">you.tovis.me</span>. Pick
          a handle with{' '}
          <span className="font-black text-textPrimary">Edit profile</span>{' '}
          above, then upgrade to make it live.
        </p>
      )}

      <Link
        href={MEMBERSHIP_URL}
        className="inline-flex w-fit items-center gap-1 rounded-card border border-accentPrimary/60 bg-accentPrimary px-4 py-2.5 text-[12px] font-black text-bgPrimary transition hover:bg-accentPrimaryHover"
      >
        Upgrade to activate <span aria-hidden="true">›</span>
      </Link>
    </div>
  )
}

function LiveState({
  vanityHost,
  vanityUrl,
  vanityQrSvg,
}: {
  vanityHost: string | null
  vanityUrl: string | null
  vanityQrSvg: string | null
}) {
  const [copied, setCopied] = useState(false)
  const [showQr, setShowQr] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    }
  }, [])

  const copy = useCallback(async () => {
    if (!vanityUrl) return
    try {
      await navigator.clipboard.writeText(vanityUrl)
      setCopied(true)
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked (permissions / insecure context) — the Open action still works.
    }
  }, [vanityUrl])

  if (!vanityUrl || !vanityHost) return null

  return (
    <div className="mt-1 grid gap-3">
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-bgPrimary px-3 py-2.5">
        <span className="truncate text-[13px] font-black text-textPrimary">
          {vanityHost}
        </span>
        <span className="ml-auto shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] font-black text-toneSuccess">
          Live
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copy}
          className="rounded-full border border-white/10 bg-bgPrimary px-3 py-2 text-[12px] font-black text-textPrimary transition hover:border-white/20"
        >
          {copied ? 'Copied ✓' : 'Copy'}
        </button>

        <a
          href={vanityUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-white/10 bg-bgPrimary px-3 py-2 text-[12px] font-black text-textPrimary transition hover:border-white/20"
        >
          Open ↗
        </a>

        <ShareButton url={vanityUrl} title={vanityHost} variant="pill" />

        {vanityQrSvg ? (
          <button
            type="button"
            onClick={() => setShowQr((v) => !v)}
            aria-expanded={showQr}
            className="rounded-full border border-white/10 bg-bgPrimary px-3 py-2 text-[12px] font-black text-textPrimary transition hover:border-white/20"
          >
            {showQr ? 'Hide QR' : 'QR code'}
          </button>
        ) : null}
      </div>

      {showQr && vanityQrSvg ? (
        <div className="grid gap-2">
          <div
            className="h-40 w-40 overflow-hidden rounded-xl bg-white p-2"
            // Server-generated SVG from our own QR helper for our own URL — not user HTML.
            dangerouslySetInnerHTML={{ __html: vanityQrSvg }}
          />
          <p className="text-[11px] text-textSecondary">
            Print it on a card or show it at your station — it opens your page.
          </p>
        </div>
      ) : null}
    </div>
  )
}

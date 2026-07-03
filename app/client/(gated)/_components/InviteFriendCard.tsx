// app/client/(gated)/_components/InviteFriendCard.tsx
//
// Home entry point for the referral loop — routes to /client/referrals where
// the shareable link + QR live.
import Link from 'next/link'

export default function InviteFriendCard() {
  return (
    <section className="rounded-card border border-textPrimary/10 bg-bgSurface p-[18px]">
      <h2 className="font-display text-[15px] font-semibold text-textPrimary">
        Invite a friend
      </h2>
      <p className="mt-1 text-[12px] leading-relaxed text-textMuted">
        Share your personal link — when a friend joins and books, the referral
        is credited to you.
      </p>
      <Link
        href="/client/referrals"
        className="mt-3 inline-flex rounded-[12px] border border-textPrimary/16 px-4 py-2 text-[11.5px] font-bold text-textSecondary transition hover:border-terra/30 hover:text-terra"
      >
        Get your link
      </Link>
    </section>
  )
}

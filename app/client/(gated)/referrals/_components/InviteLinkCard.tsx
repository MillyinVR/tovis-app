// app/client/(gated)/referrals/_components/InviteLinkCard.tsx
//
// The client's shareable referral link (their CLIENT_REFERRAL card as
// /c/{shortCode} — see lib/referral/inviteCard.ts). Server component: mints
// on first view, renders share/copy + QR.
import ShareButton from '@/app/professionals/[id]/ShareButton'
import { getCurrentUser } from '@/lib/currentUser'
import { qrSvgFor } from '@/lib/media/qr'
import { getOrCreateClientInviteCard } from '@/lib/referral/inviteCard'

export default async function InviteLinkCard() {
  const user = await getCurrentUser().catch(() => null)
  const clientId = user?.clientProfile?.id
  if (!user || !clientId) return null

  let card: Awaited<ReturnType<typeof getOrCreateClientInviteCard>>
  try {
    card = await getOrCreateClientInviteCard({
      userId: user.id,
      clientId,
    })
  } catch (error: unknown) {
    console.error('InviteLinkCard failed to load invite card', error)
    return null
  }

  const base = process.env.NEXT_PUBLIC_APP_URL?.trim()
  const shareUrl = base ? new URL(card.path, base).toString() : card.path
  const qrSvg = base ? await qrSvgFor(shareUrl) : null

  return (
    <section className="rounded-card border border-textPrimary/10 bg-bgSurface p-[18px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[15px] font-semibold text-textPrimary">
            Invite a friend
          </h2>
          <p className="mt-1 max-w-[46ch] text-[12px] leading-relaxed text-textMuted">
            Share your personal link. When a friend signs up and books, the
            referral is credited to you automatically — same as a tap on your
            physical card — and rewards apply wherever your pro offers them.
          </p>

          <div className="mt-3 inline-flex items-center gap-2 rounded-[12px] border border-textPrimary/16 px-3 py-2">
            <span className="font-mono text-[12px] font-bold tracking-[0.06em] text-textPrimary">
              {card.shortCodeDisplay}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            <ShareButton
              url={card.path}
              title="Invite a friend"
              text="Book with my link:"
              variant="pill"
            />
          </div>
        </div>

        {qrSvg ? (
          <div
            className="h-[104px] w-[104px] shrink-0 overflow-hidden rounded-[12px] border border-textPrimary/10 bg-bgPrimary/25 p-1.5 [&_svg]:h-full [&_svg]:w-full"
            aria-label="QR code for your invite link"
            role="img"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />
        ) : null}
      </div>
    </section>
  )
}

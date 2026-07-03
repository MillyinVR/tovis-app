// app/_components/profiles/SocialLinkChips.tsx
//
// Outbound social-presence chips for a pro's public surfaces (full profile
// hero + vanity page). Handles are stored without "@" (lib/profiles/socialLinks).
import { instagramUrl, tiktokUrl } from '@/lib/profiles/socialLinks'

export default function SocialLinkChips({
  instagramHandle,
  tiktokHandle,
  websiteUrl,
  className,
}: {
  instagramHandle: string | null
  tiktokHandle: string | null
  websiteUrl: string | null
  className?: string
}) {
  if (!instagramHandle && !tiktokHandle && !websiteUrl) return null

  return (
    <div className={className ?? 'flex flex-wrap items-center gap-2'}>
      {instagramHandle ? (
        <Chip
          href={instagramUrl(instagramHandle)}
          label={`Instagram @${instagramHandle}`}
        >
          IG @{instagramHandle}
        </Chip>
      ) : null}
      {tiktokHandle ? (
        <Chip href={tiktokUrl(tiktokHandle)} label={`TikTok @${tiktokHandle}`}>
          TikTok @{tiktokHandle}
        </Chip>
      ) : null}
      {websiteUrl ? (
        <Chip href={websiteUrl} label="Website">
          Website
        </Chip>
      ) : null}
    </div>
  )
}

function Chip({
  href,
  label,
  children,
}: {
  href: string
  label: string
  children: React.ReactNode
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="inline-flex items-center rounded-full border border-textPrimary/16 px-3 py-1.5 text-[11px] font-bold text-textSecondary transition hover:border-textPrimary/30 hover:text-textPrimary"
    >
      {children}
    </a>
  )
}

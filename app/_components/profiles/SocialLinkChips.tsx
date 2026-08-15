// app/_components/profiles/SocialLinkChips.tsx
//
// Outbound social-presence chips for a pro's public surfaces (full profile
// hero + vanity page). Handles are stored without "@" (lib/profiles/socialLinks).
import { buttonClassName } from '@/app/_components/ui'
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

// The kit's `ghost` button at `xs` already IS this chip: same pill, same
// `border-textPrimary/16`, same `text-[11px]`, same `font-bold`, same
// `text-textSecondary`. Only the two hover steps differed — a /30 border rather
// than the variant's /25, plus a text lift the variant has no equivalent for —
// so they ride along as a className instead of being dropped.
const CHIP_CLASS = buttonClassName({
  variant: 'ghost',
  size: 'xs',
  className: 'hover:border-textPrimary/30 hover:text-textPrimary',
})

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
      className={CHIP_CLASS}
    >
      {children}
    </a>
  )
}

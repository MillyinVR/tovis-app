// app/client/(gated)/settings/_components/SettingsRow.tsx
//
// One row on the client settings hub. The web mirror of the iOS app's
// `SettingsLinkRow` (see its `SettingsRows.swift`) — same icon + title +
// subtitle + disclosure shape, so the two platforms read as the same screen.
import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { ChevronRight } from 'lucide-react'

export type SettingsRowProps = {
  href: string
  icon: LucideIcon
  title: string
  subtitle: string
  /**
   * Anchor id for links minted BEFORE settings was split into sub-pages —
   * e.g. `/client/settings#chart-sharing`, which is stored on already-sent
   * notification rows and cannot be rewritten. Keeping the id here means an
   * old link still lands on the right row instead of the top of the hub.
   */
  legacyAnchorId?: string
}

export default function SettingsRow({
  href,
  icon: Icon,
  title,
  subtitle,
  legacyAnchorId,
}: SettingsRowProps) {
  return (
    <Link
      id={legacyAnchorId}
      href={href}
      className="brand-focus flex scroll-mt-24 items-center gap-3 rounded-card border border-textPrimary/10 bg-bgSecondary/60 px-4 py-3.5 transition hover:border-textPrimary/20 hover:bg-bgSecondary"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-textPrimary/10 bg-bgPrimary/40 text-textSecondary">
        <Icon size={16} aria-hidden="true" />
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[14px] font-black text-textPrimary">{title}</span>
        <span className="text-[12px] leading-snug text-textSecondary">
          {subtitle}
        </span>
      </span>

      <ChevronRight
        size={16}
        aria-hidden="true"
        className="shrink-0 text-textMuted"
      />
    </Link>
  )
}

// app/_components/ClientNameLink.tsx
import Link from 'next/link'
import type { ReactNode } from 'react'

type Props = {
  canLink: boolean
  clientId: string
  children: ReactNode
  className?: string
}

/**
 * Renders as a Link only when allowed.
 * If not allowed, renders plain text (no href in DOM).
 */
export default function ClientNameLink({ canLink, clientId, children, className }: Props) {
  const linkClass =
    className ??
    'font-black text-textPrimary underline decoration-white/20 underline-offset-2 hover:decoration-white/40'

  if (!canLink) {
    // No underline, no href in DOM
    return <span className={className ?? 'font-black text-textPrimary'}>{children}</span>
  }

  return (
    <Link href={`/pro/clients/${encodeURIComponent(clientId)}`} className={linkClass}>
      {children}
    </Link>
  )
}

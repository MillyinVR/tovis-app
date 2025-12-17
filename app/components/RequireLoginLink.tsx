'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

type Props = {
  href: string
  isAuthed: boolean
  children: React.ReactNode
  titleIfLocked?: string
  style?: React.CSSProperties
  className?: string
}

export default function RequireLoginLink({
  href,
  isAuthed,
  children,
  titleIfLocked,
  style,
  className,
}: Props) {
  const pathname = usePathname()
  const search = useSearchParams()
  const from = `${pathname}${search?.toString() ? `?${search.toString()}` : ''}`
  const loginHref = `/login?from=${encodeURIComponent(from)}`

  return (
    <Link
      href={isAuthed ? href : loginHref}
      title={!isAuthed ? (titleIfLocked ?? 'Log in to continue') : undefined}
      style={style}
      className={className}
      prefetch={false}
    >
      {children}
    </Link>
  )
}

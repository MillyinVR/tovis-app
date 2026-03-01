// app/_components/RequireLoginLink.tsx
'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useMemo } from 'react'

type Props = {
  href: string
  isAuthed: boolean
  children: React.ReactNode
  titleIfLocked?: string
  style?: React.CSSProperties
  className?: string
}

export default function RequireLoginLink({ href, isAuthed, children, titleIfLocked, style, className }: Props) {
  const pathname = usePathname() ?? '/'
  const searchParams = useSearchParams()

  const loginHref = useMemo(() => {
    const qs = searchParams?.toString()
    const from = `${pathname}${qs ? `?${qs}` : ''}`
    return `/login?from=${encodeURIComponent(from)}`
  }, [pathname, searchParams])

  return (
    <Link
      href={isAuthed ? href : loginHref}
      title={!isAuthed ? titleIfLocked ?? 'Log in to continue' : undefined}
      style={style}
      className={className}
      prefetch={false}
    >
      {children}
    </Link>
  )
}
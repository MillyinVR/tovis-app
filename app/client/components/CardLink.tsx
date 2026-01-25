// app/client/components/CardLink.tsx
'use client'

import { useRouter } from 'next/navigation'

export default function CardLink({
  href,
  className,
  children,
}: {
  href: string
  className?: string
  children: React.ReactNode
}) {
  const router = useRouter()

  return (
    <div
      role="link"
      tabIndex={0}
      className={className}
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          router.push(href)
        }
      }}
    >
      {children}
    </div>
  )
}

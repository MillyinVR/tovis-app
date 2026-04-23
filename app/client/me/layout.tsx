// app/client/me/layout.tsx
import type { ReactNode } from 'react'

export const dynamic = 'force-dynamic'

export default function ClientMeLayout({
  children,
  modal,
}: {
  children: ReactNode
  modal: ReactNode
}) {
  return (
    <>
      {children}
      {modal}
    </>
  )
}
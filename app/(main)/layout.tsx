// app/(main)/layout.tsx
import { getCurrentUser } from '@/lib/currentUser'
import FooterShell from './FooterShell'

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null)

  // Must match the tallest footer you render.
  const FOOTER_HEIGHT = 72

  return (
    <div className="min-h-dvh bg-bgPrimary">
      <div style={{ paddingBottom: FOOTER_HEIGHT }}>{children}</div>
      <FooterShell role={user?.role ?? 'GUEST'} />
    </div>
  )
}

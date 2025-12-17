import { getCurrentUser } from '@/lib/currentUser'
import FooterShell from './FooterShell'

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser().catch(() => null)

  // ✅ Must match the tallest footer you render.
  // ProSessionFooter height is 65 in your file.
  const FOOTER_HEIGHT = 65

  return (
    <div style={{ minHeight: '100dvh', background: '#fff' }}>
      {/* Page content */}
      <div style={{ paddingBottom: FOOTER_HEIGHT }}>{children}</div>

      {/* Footer (renders fixed/sticky itself as needed) */}
      <FooterShell role={user?.role ?? 'GUEST'} />
    </div>
  )
}

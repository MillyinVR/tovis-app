// app/support/page.tsx
import { getCurrentUser } from '@/lib/currentUser'
import SupportForm from './supportForm'
import PublicTopBar from '@/app/_components/PublicTopBar/PublicTopBar'
import { getBrandConfig } from '@/lib/brand'

export const dynamic = 'force-dynamic'

export default async function SupportPage() {
  const user = await getCurrentUser().catch(() => null)

  const brand = getBrandConfig()

  const role =
    user?.role === 'PRO'
      ? 'PRO'
      : user?.role === 'CLIENT'
        ? 'CLIENT'
        : user?.role === 'ADMIN'
          ? 'ADMIN'
          : 'GUEST'

  return (
    <main className="min-h-screen w-full text-textPrimary">
      <PublicTopBar />

      <div className="mx-auto w-full max-w-2xl px-6 pb-20 sm:px-10">

        <header className="mb-10 mt-2">
          <div className="tovis-section-label mb-4">Support</div>
          <h1 className="font-display text-[36px] font-semibold leading-tight tracking-tight">
            Get in touch
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-textSecondary">
            Report an issue, ask about your account, or get help with a booking.
            We respond to all inquiries.
          </p>
        </header>

        {/* Business details — clean list, no card boxing */}
        <div className="mb-8 grid gap-1.5 border-b border-textPrimary/8 pb-8">
          <div className="text-[12px] font-black tracking-[0.14em] text-textSecondary/60 uppercase mb-3">
            Contact details
          </div>
          <div className="text-[14px] text-textSecondary">
            <span className="font-semibold text-textPrimary">{brand.contact.businessName}</span>
          </div>
          {brand.contact.location && (
            <div className="text-[14px] text-textSecondary">
              {brand.contact.location}
            </div>
          )}
          <div className="text-[14px] text-textSecondary">
            <a
              href={`mailto:${brand.contact.supportEmail}`}
              className="font-semibold text-accentPrimary underline-offset-2 transition hover:underline"
            >
              {brand.contact.supportEmail}
            </a>
          </div>
        </div>

        <SupportForm role={role} />
      </div>
    </main>
  )
}
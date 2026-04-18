// app/support/page.tsx
import { getCurrentUser } from '@/lib/currentUser'
import SupportForm from './supportForm'
import { TRANSACTIONAL_SMS_SUMMARY } from '@/lib/transactionalSmsPolicy'

export const dynamic = 'force-dynamic'

export default async function SupportPage() {
  const user = await getCurrentUser().catch(() => null)

  const role =
    user?.role === 'PRO'
      ? 'PRO'
      : user?.role === 'CLIENT'
        ? 'CLIENT'
        : user?.role === 'ADMIN'
          ? 'ADMIN'
          : 'GUEST'

  return (
    <main className="mx-auto grid w-full max-w-2xl gap-6 px-4 py-8 text-textPrimary">
      <div className="grid gap-2">
        <h1 className="text-[22px] font-black">Support & Contact</h1>
        <p className="text-[13px] text-textSecondary">
          This is the public support/contact page for TOVIS. Use the form below
          to report an issue, request help, or ask a policy question.
        </p>
        <p className="text-[13px] text-textSecondary">
          {TRANSACTIONAL_SMS_SUMMARY}
        </p>
      </div>

      <section className="grid gap-2 rounded-card border border-surfaceGlass/10 bg-bgPrimary/20 p-4">
        <div className="text-sm font-black text-textPrimary">
          Business details
        </div>
        <div className="text-sm text-textSecondary">
          <div>
            <span className="font-black text-textPrimary">Business name:</span>{' '}
            Tovis Technology
          </div>
          <div>
            <span className="font-black text-textPrimary">Support email:</span>{' '}
            <a
              href="mailto:Support@tovis.app"
              className="font-black text-textPrimary hover:text-accentPrimary"
            >
              Support@tovis.app
            </a>
          </div>
          <div>
            <span className="font-black text-textPrimary">Location:</span>{' '}
            Encinitas, CA
          </div>
        </div>
      </section>

      <SupportForm role={role} />
    </main>
  )
}
// app/support/supportForm.tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/currentUser'
import { pickStringOrEmpty } from '@/lib/pick'
import {
  SUPPORT_MESSAGE_MAX_LEN,
  SUPPORT_SUBJECT_MAX_LEN,
  createSupportTicket,
} from '@/lib/support/createSupportTicket'

export const dynamic = 'force-dynamic'

export default function SupportForm() {
  async function submit(formData: FormData) {
    'use server'

    // Re-read the user inside the action rather than trusting a prop: a client
    // could post this form with any role it liked.
    const user = await getCurrentUser().catch(() => null)

    const result = await createSupportTicket({
      author: user ? { id: user.id, role: user.role } : null,
      subject: pickStringOrEmpty(formData.get('subject')),
      message: pickStringOrEmpty(formData.get('message')),
    })

    if (!result.ok) redirect(`/support?error=${result.error.code.toLowerCase()}`)

    redirect('/support?sent=1')
  }

  return (
    <form action={submit} className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4 grid gap-4">
      <label className="grid gap-2">
        <div className="text-[12px] font-black">Subject</div>
        <input
          name="subject"
          maxLength={SUPPORT_SUBJECT_MAX_LEN}
          className="h-11 rounded-xl border border-white/10 bg-bgPrimary/70 px-3 text-[13px] outline-none focus:ring-2 focus:ring-accentPrimary/40"
          placeholder="e.g. Booking not confirming"
        />
      </label>

      <label className="grid gap-2">
        <div className="text-[12px] font-black">Message</div>
        <textarea
          name="message"
          rows={6}
          maxLength={SUPPORT_MESSAGE_MAX_LEN}
          className="rounded-xl border border-white/10 bg-bgPrimary/70 px-3 py-3 text-[13px] outline-none focus:ring-2 focus:ring-accentPrimary/40"
          placeholder="Tell us what happened, what you expected, and anything relevant."
        />
      </label>

      <button
        type="submit"
        className="rounded-full border border-accentPrimary/60 bg-accentPrimary px-4 py-3 text-[13px] font-black text-bgPrimary hover:bg-accentPrimaryHover active:scale-[0.99]"
      >
        Send to Admin
      </button>

      <p className="text-[11px] text-textSecondary">
        Please don’t include passwords, verification codes, or secret keys. We’ll get back to you as soon as we can, but response times may vary based on the volume of requests.)
      </p>
    </form>
  )
}

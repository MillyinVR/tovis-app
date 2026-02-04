// app/support/supportForm.tsx
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'

export const dynamic = 'force-dynamic'

type Props = { role: string }

function pickStr(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

export default function SupportForm({ role }: Props) {
  async function submit(formData: FormData) {
    'use server'

    const user = await getCurrentUser().catch(() => null)

    const subject = pickStr(formData.get('subject'))
    const message = pickStr(formData.get('message'))

    if (!subject || !message) redirect('/support?error=missing')

    await prisma.supportTicket.create({
      data: {
        createdByUserId: user?.id ?? null,
        createdByRole: role,
        subject,
        message,
        status: 'OPEN',
      },
      select: { id: true },
    })

    redirect('/support?sent=1')
  }

  return (
    <form action={submit} className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4 grid gap-4">
      <label className="grid gap-2">
        <div className="text-[12px] font-black">Subject</div>
        <input
          name="subject"
          className="h-11 rounded-xl border border-white/10 bg-bgPrimary/70 px-3 text-[13px] outline-none focus:ring-2 focus:ring-accentPrimary/40"
          placeholder="e.g. Booking not confirming"
        />
      </label>

      <label className="grid gap-2">
        <div className="text-[12px] font-black">Message</div>
        <textarea
          name="message"
          rows={6}
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
        Please don’t include passwords, verification codes, or secret keys. (Yes, I have to say it.)
      </p>
    </form>
  )
}

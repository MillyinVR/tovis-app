// app/support/supportForm.tsx
import { redirect } from 'next/navigation'
import { TextInput, Textarea } from '@/app/_components/ui'
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
    <form action={submit} className="tovis-glass rounded-card border border-surfaceGlass/10 bg-bgSecondary p-4 grid gap-4">
      {/* The two headings stay hand-written. They ARE field labels, but they
          carry no colour token and so inherit `text-textPrimary` from the page,
          where the kit's FieldLabel is `text-textSecondary` — migrating them is
          a COLOUR change on a public page, not the fill decision this PR made. */}
      <label className="grid gap-2">
        <div className="text-[12px] font-black">Subject</div>
        <TextInput
          name="subject"
          surface="translucent"
          maxLength={SUPPORT_SUBJECT_MAX_LEN}
          // This field is sized by HEIGHT, not by padding, and predates the
          // surface. `py-0` is load-bearing: the kit's `py-3` inside a fixed
          // `h-11` shrinks the content box from 42px to 18px, which measured as
          // a real padding diff in the A/B and would clip at a larger type size.
          className="h-11 py-0"
          placeholder="e.g. Booking not confirming"
        />
      </label>

      <label className="grid gap-2">
        <div className="text-[12px] font-black">Message</div>
        <Textarea
          name="message"
          surface="translucent"
          rows={6}
          maxLength={SUPPORT_MESSAGE_MAX_LEN}
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

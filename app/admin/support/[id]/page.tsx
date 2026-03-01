// app/admin/support/[id]/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { SupportTicketStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }

async function getParams(ctx: Ctx) {
  return await Promise.resolve(ctx.params)
}

async function requireAdmin() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login')
  if (user.role !== 'ADMIN') redirect('/forbidden')
  return user
}

function pickStr(v: unknown) {
  return typeof v === 'string' ? v.trim() : ''
}

function parseSupportTicketStatus(v: unknown): SupportTicketStatus | null {
  const s = typeof v === 'string' ? v.trim().toUpperCase() : ''
  if (s === 'OPEN') return SupportTicketStatus.OPEN
  if (s === 'IN_PROGRESS') return SupportTicketStatus.IN_PROGRESS
  if (s === 'CLOSED') return SupportTicketStatus.CLOSED
  return null
}

export default async function AdminSupportTicketPage(req: Ctx) {
  await requireAdmin()

  const { id } = await getParams(req)
  const ticketId = pickStr(id)
  if (!ticketId) redirect('/admin/support')

  const ticket = await prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      createdAt: true,
      createdByRole: true,
      createdByUserId: true,
      subject: true,
      message: true,
      status: true,
    },
  })

  if (!ticket) redirect('/admin/support')

  async function setStatus(formData: FormData) {
    'use server'

    const admin = await getCurrentUser().catch(() => null)
    if (!admin || admin.role !== 'ADMIN') redirect('/forbidden')

    const nextRaw = String(formData.get('status') ?? '').toUpperCase()
    if (nextRaw !== 'OPEN' && nextRaw !== 'IN_PROGRESS' && nextRaw !== 'CLOSED') redirect('/admin/support')

    const next = nextRaw as SupportTicketStatus

    await prisma.supportTicket.update({
      where: { id: ticketId },
      data: {
        status: next,
        handledByAdminId: admin.id,
        handledAt: new Date(),
      },
      select: { id: true },
    })

    redirect(`/admin/support/${encodeURIComponent(ticketId)}`)
  }

  const btn =
    'inline-flex items-center rounded-full border px-3 py-2 text-[12px] font-black transition active:scale-[0.98]'
  const btnSoft = 'border-white/12 bg-bgPrimary/55 hover:border-white/22 hover:bg-bgPrimary/70'
  const btnAccent = 'border-accentPrimary/50 bg-accentPrimary text-bgPrimary hover:bg-accentPrimaryHover'

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-6 text-textPrimary">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link
          href="/admin/support"
          className="inline-flex items-center rounded-full border border-white/12 bg-bgPrimary/55 px-3 py-2 text-[12px] font-black hover:border-white/22 hover:bg-bgPrimary/70"
        >
          ← Back
        </Link>

        <div className="text-[12px] font-black text-textSecondary">Status: {ticket.status}</div>
      </div>

      <div className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
        <div className="text-[16px] font-black">{ticket.subject}</div>
        <div className="mt-1 text-[11px] text-textSecondary">
          {ticket.createdByRole ?? 'UNKNOWN'} • {new Date(ticket.createdAt).toLocaleString()}
          {ticket.createdByUserId ? ` • user:${ticket.createdByUserId}` : ''}
        </div>

        <div className="mt-4 whitespace-pre-wrap text-[13px] text-textSecondary">{ticket.message}</div>

        <form action={setStatus} className="mt-5 flex flex-wrap gap-2">
          <button name="status" value="OPEN" className={[btn, btnSoft].join(' ')}>
            Mark Open
          </button>
          <button name="status" value="IN_PROGRESS" className={[btn, btnSoft].join(' ')}>
            In Progress
          </button>
          <button name="status" value="CLOSED" className={[btn, btnAccent].join(' ')}>
            Close
          </button>
        </form>
      </div>
    </main>
  )
}
// app/admin/support/page.tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { getCurrentUser } from '@/lib/currentUser'
import { Role, SupportTicketStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const user = await getCurrentUser().catch(() => null)
  if (!user) redirect('/login')
  if (user.role !== Role.ADMIN) redirect('/forbidden')
  return user
}

type SearchParams = Record<string, string | string[] | undefined>

function pickStatus(v: unknown): SupportTicketStatus {
  const raw = Array.isArray(v) ? v[0] : v
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : ''

  if (s === SupportTicketStatus.OPEN) return SupportTicketStatus.OPEN
  if (s === SupportTicketStatus.IN_PROGRESS) return SupportTicketStatus.IN_PROGRESS
  if (s === SupportTicketStatus.CLOSED) return SupportTicketStatus.CLOSED

  return SupportTicketStatus.OPEN
}

export default async function AdminSupportPage(props: { searchParams?: SearchParams | Promise<SearchParams> }) {
  await requireAdmin()

  const sp = await Promise.resolve(props.searchParams ?? {})
  const status = pickStatus(sp.status)

  const tickets = await prisma.supportTicket.findMany({
    where: { status },
    orderBy: { createdAt: 'desc' },
    take: 80,
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

  function tabHref(s: SupportTicketStatus) {
    return `/admin/support?status=${encodeURIComponent(s)}`
  }

  const tabBase =
    'inline-flex items-center rounded-full border px-3 py-2 text-[12px] font-black transition active:scale-[0.98]'
  const tabOn = 'border-accentPrimary/40 bg-bgPrimary/70 text-textPrimary'
  const tabOff = 'border-white/10 bg-bgPrimary/35 text-textSecondary hover:border-white/18 hover:bg-bgPrimary/55'

  return (
    <main className="mx-auto w-full max-w-1100px px-4 py-6 text-textPrimary">
      <div className="mb-5 flex flex-col gap-2">
        <h1 className="text-[22px] font-black">Support / Issues</h1>
        <p className="text-[13px] text-textSecondary">Incoming reports from clients and professionals.</p>

        <div className="mt-2 flex flex-wrap gap-2">
          <Link
            href={tabHref(SupportTicketStatus.OPEN)}
            className={[tabBase, status === SupportTicketStatus.OPEN ? tabOn : tabOff].join(' ')}
          >
            Open
          </Link>

          <Link
            href={tabHref(SupportTicketStatus.IN_PROGRESS)}
            className={[tabBase, status === SupportTicketStatus.IN_PROGRESS ? tabOn : tabOff].join(' ')}
          >
            In progress
          </Link>

          <Link
            href={tabHref(SupportTicketStatus.CLOSED)}
            className={[tabBase, status === SupportTicketStatus.CLOSED ? tabOn : tabOff].join(' ')}
          >
            Closed
          </Link>
        </div>
      </div>

      {tickets.length === 0 ? (
        <div className="rounded-card border border-white/10 bg-bgSecondary p-4 text-[13px] text-textSecondary">
          Nothing here. Either everything is perfect… or everyone gave up. (Let’s assume perfect.)
        </div>
      ) : (
        <div className="grid gap-3">
          {tickets.map((t) => (
            <div key={t.id} className="tovis-glass rounded-card border border-white/10 bg-bgSecondary p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[13px] font-black">{t.subject}</div>
                  <div className="mt-1 text-[11px] text-textSecondary">
                    {t.createdByRole ?? 'UNKNOWN'} • {new Date(t.createdAt).toLocaleString()}
                    {t.createdByUserId ? ` • user:${t.createdByUserId}` : ''}
                  </div>
                </div>

                <Link
                  href={`/admin/support/${encodeURIComponent(t.id)}`}
                  className="inline-flex items-center rounded-full border border-white/12 bg-bgPrimary/55 px-3 py-2 text-[12px] font-black hover:border-white/22 hover:bg-bgPrimary/70"
                >
                  View
                </Link>
              </div>

              <div className="mt-3 whitespace-pre-wrap text-[13px] text-textSecondary">
                {t.message.length > 320 ? `${t.message.slice(0, 320)}…` : t.message}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
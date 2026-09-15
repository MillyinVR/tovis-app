import { AdminPermissionRole, NotificationEventKey, Prisma, Role } from '@prisma/client'
import { createProNotification } from '@/lib/notifications/proNotifications'
import { createAdminNotification } from '@/lib/notifications/adminNotifications'
import { lookAnalysisCopy as copy } from '@/lib/brand/lookAnalysisCopy'

export async function notifyLookAnalysis(tx: Prisma.TransactionClient, args: { id: string; professionalId: string; revision: number; admin: boolean }) {
  const common = { title: args.admin ? copy.adminNotificationTitle : copy.proNotificationTitle, body: args.admin ? copy.adminNotificationBody : copy.proNotificationBody,
    dedupeKey: `look-analysis:${args.id}:${args.revision}:${args.admin ? 'admin' : 'pro'}`, tx }
  if (!args.admin) {
    await createProNotification({ ...common, professionalId: args.professionalId,
      eventKey: NotificationEventKey.LOOK_MEDIA_CLARIFICATION, href: '/pro/looks/analysis' })
    return
  }
  // Cross-tenant media review is restricted to super admins, including who receives its doorbell.
  const admins = await tx.user.findMany({ where: { role: Role.ADMIN, adminPermissions: { some: { role: AdminPermissionRole.SUPER_ADMIN } } }, select: { id: true } })
  for (const admin of admins) await createAdminNotification({ ...common, adminUserId: admin.id,
    eventKey: NotificationEventKey.LOOK_MEDIA_ADMIN_REVIEW, href: '/admin/looks/analysis' })
}

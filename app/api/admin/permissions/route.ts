// app/api/admin/permissions/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { AdminPermissionRole } from '@prisma/client'

import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { pickMethod, pickString } from '@/app/api/_utils/pick'
import { jsonFail, jsonOk } from '@/app/api/_utils/responses'
import { hasAdminPermission } from '@/lib/adminPermissions'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

function normalizeRole(value: string | null): AdminPermissionRole | null {
  const role = (value ?? '').trim().toUpperCase()

  if (role === AdminPermissionRole.SUPER_ADMIN) {
    return AdminPermissionRole.SUPER_ADMIN
  }

  if (role === AdminPermissionRole.SUPPORT) {
    return AdminPermissionRole.SUPPORT
  }

  if (role === AdminPermissionRole.REVIEWER) {
    return AdminPermissionRole.REVIEWER
  }

  return null
}

function trimOrNull(value: string | null): string | null {
  const text = (value ?? '').trim()
  return text || null
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message.trim()
  ) {
    return error.message
  }

  return 'Internal server error'
}

async function requireSuperAdmin() {
  const auth = await requireUser({ roles: ['ADMIN'] })
  if (!auth.ok) return auth

  const allowed = await hasAdminPermission({
    adminUserId: auth.user.id,
    allowedRoles: [AdminPermissionRole.SUPER_ADMIN],
  })

  if (!allowed) {
    return {
      ok: false as const,
      res: jsonFail(403, 'Forbidden'),
    }
  }

  return auth
}

export async function GET(): Promise<Response> {
  try {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return auth.res

    const [users, permissions, professionals, services, categories] =
      await Promise.all([
        prisma.user.findMany({
          select: {
            id: true,
            email: true,
            role: true,
          },
          orderBy: { email: 'asc' },
          take: 5000,
        }),

        prisma.adminPermission.findMany({
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            role: true,
            adminUserId: true,
            professionalId: true,
            serviceId: true,
            categoryId: true,
            createdAt: true,
          },
          take: 5000,
        }),

        prisma.professionalProfile.findMany({
          select: {
            id: true,
            businessName: true,
            location: true,
          },
          orderBy: { id: 'asc' },
          take: 2000,
        }),

        prisma.service.findMany({
          select: {
            id: true,
            name: true,
          },
          orderBy: { name: 'asc' },
          take: 2000,
        }),

        prisma.serviceCategory.findMany({
          select: {
            id: true,
            name: true,
            slug: true,
          },
          orderBy: { name: 'asc' },
          take: 2000,
        }),
      ])

    return jsonOk(
      {
        users,
        permissions: permissions.map((permission) => ({
          ...permission,
          createdAt: permission.createdAt.toISOString(),
        })),
        professionals: professionals.map((professional) => {
          const location = professional.location?.trim()

          return {
            id: professional.id,
            label: `${professional.businessName ?? 'Unnamed pro'}${
              location ? ` • ${location}` : ''
            }`,
          }
        }),
        services: services.map((service) => ({
          id: service.id,
          label: service.name,
        })),
        categories: categories.map((category) => ({
          id: category.id,
          label: `${category.name} (${category.slug})`,
        })),
      },
      200,
    )
  } catch (error: unknown) {
    console.error('GET /api/admin/permissions error', error)
    return jsonFail(500, 'Internal server error')
  }
}

export async function POST(req: NextRequest): Promise<Response> {
  try {
    const auth = await requireSuperAdmin()
    if (!auth.ok) return auth.res

    const form = await req.formData()
    const method = pickMethod(form.get('_method')) ?? 'POST'

    if (method !== 'POST') {
      return jsonFail(400, 'Unsupported operation.')
    }

    const adminUserId = trimOrNull(pickString(form.get('adminUserId')))
    const role = normalizeRole(pickString(form.get('role')))

    const professionalId = trimOrNull(pickString(form.get('professionalId')))
    const serviceId = trimOrNull(pickString(form.get('serviceId')))
    const categoryId = trimOrNull(pickString(form.get('categoryId')))

    if (!adminUserId || !role) {
      return jsonFail(400, 'Missing adminUserId/role')
    }

    await prisma.adminPermission.create({
      data: {
        adminUserId,
        role,
        professionalId,
        serviceId,
        categoryId,
      },
      select: { id: true },
    })

    await prisma.adminActionLog
      .create({
        data: {
          adminUserId: auth.user.id,
          action: 'ADMIN_PERMISSION_CREATED',
          note: [
            `for=${adminUserId}`,
            `role=${role}`,
            `pro=${professionalId ?? '-'}`,
            `svc=${serviceId ?? '-'}`,
            `cat=${categoryId ?? '-'}`,
          ].join(' '),
        },
      })
      .catch(() => null)

    return NextResponse.redirect(new URL('/admin/permissions', req.url), {
      status: 303,
    })
  } catch (error: unknown) {
    const message = errorMessageFromUnknown(error)
    console.error('POST /api/admin/permissions error', error)
    return jsonFail(500, message)
  }
}
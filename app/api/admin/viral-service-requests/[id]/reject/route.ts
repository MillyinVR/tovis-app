// app/api/admin/viral-service-requests/[id]/reject/route.ts
import { NextRequest } from 'next/server'
import {
  AdminPermissionRole,
  ModerationStatus,
  Role,
  ViralServiceRequestStatus,
} from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireUser } from '@/app/api/_utils/auth/requireUser'
import { requireAdminPermission } from '@/app/api/_utils/auth/requireAdminPermission'
import { prisma } from '@/lib/prisma'
import { updateViralRequestStatus } from '@/lib/viralRequests'
import { toViralRequestDto } from '@/lib/viralRequests/contracts'

export const dynamic = 'force-dynamic'

type Params = { id: string }
type Ctx = { params: Params | Promise<Params> }
type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function trimString(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null
}

function trimId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function getParams(ctx: Ctx): Promise<Params> {
  return await Promise.resolve(ctx.params)
}

async function readJsonBody(req: NextRequest): Promise<UnknownRecord | null> {
  const contentType = req.headers.get('content-type') ?? ''
  if (contentType && !contentType.includes('application/json')) {
    return null
  }

  try {
    const raw: unknown = await req.json()
    return isRecord(raw) ? raw : {}
  } catch {
    return {}
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const auth = await requireUser({ roles: [Role.ADMIN] })
    if (!auth.ok) return auth.res
    const user = auth.user

    const { id } = await getParams(ctx)
    const requestId = trimId(id)
    if (!requestId) {
      return jsonFail(400, 'Missing viral request id.')
    }

    const existing = await prisma.viralServiceRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        requestedCategoryId: true,
      },
    })

    if (!existing) {
      return jsonFail(404, 'Viral request not found.')
    }

    const perm = await requireAdminPermission({
      adminUserId: user.id,
      allowedRoles: [
        AdminPermissionRole.SUPER_ADMIN,
        AdminPermissionRole.REVIEWER,
      ],
      scope: existing.requestedCategoryId
        ? { categoryId: existing.requestedCategoryId }
        : undefined,
    })
    if (!perm.ok) return perm.res

    const body = await readJsonBody(req)
    if (body === null) {
      return jsonFail(415, 'Content-Type must be application/json.')
    }

    const adminNotes = trimString(body.adminNotes)

    const request = await updateViralRequestStatus(prisma, {
      requestId,
      nextStatus: ViralServiceRequestStatus.REJECTED,
      reviewerUserId: user.id,
      adminNotes,
      moderationStatus: ModerationStatus.REJECTED,
    })

    await prisma.adminActionLog
      .create({
        data: {
          adminUserId: user.id,
          categoryId: existing.requestedCategoryId ?? undefined,
          action: 'VIRAL_REQUEST_REJECTED',
          note: adminNotes
            ? `requestId=${requestId} note=${adminNotes}`
            : `requestId=${requestId}`,
        },
      })
      .catch(() => null)

    return jsonOk({
      request: toViralRequestDto(request),
    })
  } catch (error: unknown) {
    console.error('POST /api/admin/viral-service-requests/[id]/reject error', error)
    const message = error instanceof Error ? error.message : 'Internal server error'

    if (message === 'Viral request not found.') {
      return jsonFail(404, message)
    }

    if (message.startsWith('Invalid viral request status transition:')) {
      return jsonFail(409, message)
    }

    if (message.startsWith('Text must be ')) {
      return jsonFail(400, message)
    }

    return jsonFail(500, message)
  }
}
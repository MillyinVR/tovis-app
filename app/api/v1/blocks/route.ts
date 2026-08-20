// app/api/v1/blocks/route.ts
//
// The person block (App Store guideline 1.2 — a UGC app must let a user block
// abusive users). GET lists the accounts the viewer has blocked; POST blocks
// one. Lifting a block is DELETE /api/v1/blocks/[blockId].
//
// WHY THE TARGET IS NOT A USER ID
// -------------------------------
// No client ever learns a User id — the looks feed DTO carries a
// ProfessionalProfile id for a pro and a bare `@handle` for a client author,
// and `professionalId !== userId`. So the body names the person the way the
// surface the viewer blocked them from already names them, and the server
// resolves it. A handle goes through HandleRegistration, the one global handle
// namespace, so it resolves to exactly one person.
import { Prisma } from '@prisma/client'

import { jsonFail, jsonOk, pickString, requireUser } from '@/app/api/_utils'
import {
  loadBlockedAccounts,
  resolveBlockTargetByHandle,
  resolveBlockTargetByProfessionalId,
} from '@/lib/blocks/blockTargets'
import type {
  BlockCreatedResponseDto,
  BlocksListResponseDto,
} from '@/lib/blocks/types'
import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    const blocks = await loadBlockedAccounts(prisma, { userId: auth.user.id })

    // BlockedAccount is already the wire shape (no User id) — see
    // lib/blocks/blockTargets.
    const body: BlocksListResponseDto = { blocks }
    return jsonOk(body, 200)
  } catch (error) {
    console.error('GET /api/v1/blocks error', { error: safeError(error) })
    return jsonFail(500, 'Couldn’t load your blocked accounts. Try again.', {
      code: 'INTERNAL',
    })
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.res

    let raw: unknown
    try {
      raw = await req.json()
    } catch {
      return jsonFail(400, 'Invalid request body.', { code: 'INVALID_BODY' })
    }

    const body = (raw ?? {}) as Record<string, unknown>
    const handle = pickString(body.handle)
    const professionalId = pickString(body.professionalId)

    if (!handle && !professionalId) {
      return jsonFail(400, 'Tell us who to block.', { code: 'MISSING_TARGET' })
    }

    const target = professionalId
      ? await resolveBlockTargetByProfessionalId(prisma, professionalId)
      : await resolveBlockTargetByHandle(prisma, handle ?? '')

    if (!target) {
      return jsonFail(404, 'Account not found.', { code: 'TARGET_NOT_FOUND' })
    }

    // Blocking yourself would erase your own content from your own feeds. The
    // database refuses it too (UserBlock_not_self); this is the readable half.
    if (target.userId === auth.user.id) {
      return jsonFail(400, 'You can’t block yourself.', {
        code: 'CANNOT_BLOCK_SELF',
      })
    }

    let blockId: string
    try {
      const created = await prisma.userBlock.create({
        data: { blockerUserId: auth.user.id, blockedUserId: target.userId },
        select: { id: true },
      })
      blockId = created.id
    } catch (error) {
      // Already blocked — idempotent, and the caller still needs the row id to
      // render the Unblock control (mirrors the like/hide routes' P2002 swallow).
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002'
      ) {
        throw error
      }
      const existing = await prisma.userBlock.findUnique({
        where: {
          blockerUserId_blockedUserId: {
            blockerUserId: auth.user.id,
            blockedUserId: target.userId,
          },
        },
        select: { id: true },
      })
      if (!existing) throw error
      blockId = existing.id
    }

    const responseBody: BlockCreatedResponseDto = {
      blockId,
      handle: target.handle,
      displayName: target.displayName,
      blocked: true,
    }
    return jsonOk(responseBody, 200)
  } catch (error) {
    console.error('POST /api/v1/blocks error', { error: safeError(error) })
    return jsonFail(500, 'Couldn’t block this account. Try again.', {
      code: 'INTERNAL',
    })
  }
}

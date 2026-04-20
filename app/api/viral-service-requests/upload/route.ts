// app/api/viral-service-requests/upload/route.ts
import { NextRequest } from 'next/server'
import { ViralServiceRequestStatus } from '@prisma/client'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { prisma } from '@/lib/prisma'
import { buildViralRequestUploadTargetPath } from '@/lib/viralRequests'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function trimString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readSize(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readSignedUrl(value: unknown): string | null {
  if (!isRecord(value)) return null
  return typeof value.signedUrl === 'string' ? value.signedUrl : null
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

export async function POST(req: NextRequest) {
  try {
    const auth = await requireClient()
    if (!auth.ok) return auth.res

    const base = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
    if (!base) return jsonFail(500, 'NEXT_PUBLIC_SUPABASE_URL missing')

    const body = await readJsonBody(req)
    if (body === null) {
      return jsonFail(415, 'Content-Type must be application/json.')
    }

    const requestId = trimString(body.requestId)
    const fileName = trimString(body.fileName)
    const contentType = trimString(body.contentType)
    const size = readSize(body.size)

    if (!requestId) return jsonFail(400, 'Missing requestId')
    if (!fileName) return jsonFail(400, 'Missing fileName')
    if (!contentType) return jsonFail(400, 'Missing contentType')

    const isImage = contentType.startsWith('image/')
    const isVideo = contentType.startsWith('video/')
    if (!isImage && !isVideo) {
      return jsonFail(400, 'Only image/video uploads allowed')
    }

    if (size != null && size > 30 * 1024 * 1024) {
      return jsonFail(400, 'File too large (max 30MB)')
    }

    const requestRow = await prisma.viralServiceRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        clientId: true,
        status: true,
      },
    })

    if (!requestRow) return jsonFail(404, 'Viral request not found.')
    if (requestRow.clientId !== auth.clientId) return jsonFail(403, 'Forbidden')

    if (
      requestRow.status === ViralServiceRequestStatus.APPROVED ||
      requestRow.status === ViralServiceRequestStatus.REJECTED
    ) {
      return jsonFail(409, 'Cannot prepare uploads for a finalized viral request.')
    }

    let path: string
    try {
      path = buildViralRequestUploadTargetPath({
        requestId,
        fileName,
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Invalid upload parameters'
      return jsonFail(400, message)
    }

    const bucket = 'media-public'
    const admin = getSupabaseAdmin()
    const { data, error } = await admin.storage
      .from(bucket)
      .createSignedUploadUrl(path, { upsert: false })

    if (error) {
      return jsonFail(500, error.message || 'Failed to create signed upload URL')
    }

    if (!data?.token) {
      return jsonFail(500, 'Signed upload token missing')
    }

    const signedUrl = readSignedUrl(data)
    const publicUrl = `${base}/storage/v1/object/public/${bucket}/${path}`

    return jsonOk({
      requestId,
      bucket,
      path,
      token: data.token,
      signedUrl,
      publicUrl,
      isPublic: true,
    })
  } catch (error: unknown) {
    console.error('POST /api/viral-service-requests/upload error', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonFail(500, message)
  }
}
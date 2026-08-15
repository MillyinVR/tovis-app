// app/api/v1/viral-service-requests/upload/route.ts
import { NextRequest } from 'next/server'

import { jsonFail, jsonOk } from '@/app/api/_utils'
import { requireClient } from '@/app/api/_utils/auth/requireClient'
import { prisma } from '@/lib/prisma'
import {
  buildViralRequestUploadPublicUrl,
  buildViralRequestUploadTargetPath,
  loadClientOwnedViralRequestForWrite,
} from '@/lib/viralRequests'
import { getSupabaseAdmin } from '@/lib/supabaseAdmin'
import { BUCKETS } from '@/lib/storageBuckets'
import { isRecord, type UnknownRecord } from '@/lib/guards'
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_LABEL } from '@/lib/media/uploadLimits'
import { getStorageEnvironmentMismatch } from '@/lib/media/storageEnvironment'

export const dynamic = 'force-dynamic'

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

    // Refuse rather than silently PUT bytes into a remote bucket from a local
    // database (see lib/media/storageEnvironment.ts). After the auth gate so an
    // anonymous caller gets its 401 and never sees infra hostnames; fails open,
    // so it returns null in production and CI.
    const storageMismatch = getStorageEnvironmentMismatch()
    if (storageMismatch) return jsonFail(500, storageMismatch)

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

    if (size != null && size > UPLOAD_MAX_BYTES) {
      return jsonFail(400, `File too large (max ${UPLOAD_MAX_LABEL})`)
    }

    // The same gate the persist route runs — signing a write and recording what
    // it produced must never be able to disagree about who may do it.
    const loaded = await loadClientOwnedViralRequestForWrite(prisma, {
      clientId: auth.clientId,
      requestId,
    })

    if (!loaded.ok) {
      if (loaded.reason === 'NOT_FOUND') {
        return jsonFail(404, 'Viral request not found.')
      }
      if (loaded.reason === 'FORBIDDEN') return jsonFail(403, 'Forbidden')
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

    const bucket = BUCKETS.mediaPublic
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
    // Built by the same helper the persist route validates against, so a URL we
    // hand out here is always one it will accept.
    const publicUrl = buildViralRequestUploadPublicUrl({
      supabaseBaseUrl: base,
      path,
    })

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
    console.error('POST /api/v1/viral-service-requests/upload error', error)
    const message = error instanceof Error ? error.message : 'Internal server error'
    return jsonFail(500, message)
  }
}
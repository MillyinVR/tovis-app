import {
  BookingStatus,
  ConsultActorType,
  ConsultAgreementKind,
  ConsultAuditAction,
  ConsultCaptureStatus,
  ConsultSessionStatus,
  Prisma,
  PrismaClient,
  ProfessionalLocationType,
  Role,
  ServiceLocationType,
  UploadSessionStatus,
} from '@prisma/client'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.JWT_SECRET ||= 'integration-test-jwt-secret'
})

const mockRequireClient = vi.hoisted(() => vi.fn())
const fake = vi.hoisted(() => ({
  objects: new Map<
    string,
    { contentType: 'image/jpeg'; sizeBytes: number; checksumSha256: string | null }
  >(),
  signedPaths: [] as string[],
  purgedPaths: [] as string[],
  failPurgePaths: new Set<string>(),
  qualityByShot: new Map<
    string,
    {
      accepted: boolean
      reasonCode:
        | 'PASS'
        | 'WARM_INDOOR_LIGHT'
        | 'COLOR_CAST'
        | 'VIEW_MISMATCH'
        | 'HAIR_NOT_VISIBLE'
        | 'BLURRY'
        | 'TOO_DARK'
        | 'TOO_BRIGHT'
        | 'OTHER_QUALITY_FAILURE'
      retakeTip: string | null
      model: string
    }
  >(),
  modelCalls: [] as string[],
  pathSequence: 0,
}))

vi.mock('@/app/api/_utils/auth/requireClient', () => ({
  requireClient: mockRequireClient,
}))

vi.mock('@/lib/consult/captureStorage', () => {
  class FakeStorageError extends Error {
    constructor(readonly kind: 'unavailable' | 'missing' | 'invalid') {
      super('Private capture storage is unavailable.')
      this.name = 'ConsultCaptureStorageError'
    }
  }
  return {
    CONSULT_CAPTURE_BUCKET: 'media-private',
    CONSULT_CAPTURE_MAX_BYTES: 5_000_000,
    ConsultCaptureStorageError: FakeStorageError,
    consultCaptureObjectPath() {
      fake.pathSequence += 1
      const tail = fake.pathSequence.toString(16).padStart(12, '0')
      return `consult-raw/v1/00000000-0000-4000-8000-${tail}.jpg`
    },
    consultCaptureStorage: {
      assertReady: vi.fn().mockResolvedValue(undefined),
      async createSignedUpload(path: string) {
        fake.signedPaths.push(path)
        return {
          token: 'signed-upload-secret',
          signedUrl: 'https://storage.test/signed-upload-secret',
        }
      },
      async inspectObject(args: {
        path: string
        expectedContentType: 'image/jpeg'
        maxBytes: number
        expectedChecksumSha256: string | null
      }) {
        const object = fake.objects.get(args.path)
        if (!object) throw new FakeStorageError('missing')
        if (
          object.contentType !== args.expectedContentType ||
          object.sizeBytes > args.maxBytes ||
          (args.expectedChecksumSha256 &&
            object.checksumSha256 !== args.expectedChecksumSha256)
        ) {
          throw new FakeStorageError('invalid')
        }
        return object
      },
      async readObject(args: {
        path: string
        expectedContentType: 'image/jpeg'
        maxBytes: number
      }) {
        const object = fake.objects.get(args.path)
        if (
          !object ||
          object.contentType !== args.expectedContentType ||
          object.sizeBytes > args.maxBytes
        ) {
          throw new FakeStorageError('missing')
        }
        return { base64: 'bm90LXJhdy1pbi1kYg==', mediaType: object.contentType }
      },
      async purgeObject(path: string) {
        if (fake.failPurgePaths.delete(path)) {
          throw new FakeStorageError('unavailable')
        }
        fake.objects.delete(path)
        if (fake.objects.has(path)) {
          throw new FakeStorageError('unavailable')
        }
        fake.purgedPaths.push(path)
      },
    },
  }
})

vi.mock('@/lib/consult/captureVision', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/consult/captureVision')>()
  return {
    ...original,
    async checkHairColorCapture(input: { shotKey: string }) {
      fake.modelCalls.push(input.shotKey)
      return (
        fake.qualityByShot.get(input.shotKey) ?? {
          accepted: true,
          reasonCode: 'PASS',
          retakeTip: null,
          model: 'fake-quality-model',
        }
      )
    },
  }
})

import { POST as attachCapture } from '@/app/api/v1/client/consult/[id]/capture/attach/route'
import { GET as getCapture } from '@/app/api/v1/client/consult/[id]/capture/route'
import { POST as issueUpload } from '@/app/api/v1/client/consult/[id]/capture/uploads/route'
import { POST as checkQuality } from '@/app/api/v1/client/consult/[id]/capture/[captureId]/quality/route'
import { DELETE as deleteCapture } from '@/app/api/v1/client/consult/[id]/capture/[captureId]/route'
import {
  HAIR_COLOR_CAPTURE_PACK_VERSION,
  HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
  type HairColorCaptureShotKey,
} from '@/lib/consult/capturePack'
import {
  attachConsultCaptureUpload,
} from '@/lib/consult/captureContract'
import {
  purgeConsultSessionRawObjects,
  runConsultCapturePurgeSweep,
} from '@/lib/consult/capturePurge'
import {
  acceptConsultAgreement,
  appendHairColorIntakeRevision,
  revokeConsultAgreement,
} from '@/lib/consult/writeBoundary'
import {
  HAIR_COLOR_INTAKE_PACK_VERSION,
  HAIR_COLOR_INTAKE_SCHEMA_VERSION,
} from '@/lib/consult/intakePack'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('Run with pnpm test:integration')
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
const tag = `consult_capture_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
const versionBase = 2_000_000 + Math.floor(Math.random() * 100_000)

let tenantId = ''
let proUserId = ''
let professionalId = ''
let locationId = ''
let categoryId = ''
let serviceId = ''
let consentVersionId = ''
let adultVersionId = ''
const userIds: string[] = []
const clientIds: string[] = []
const bookingIds: string[] = []
const sessionIds: string[] = []
let bookingSequence = 0

type ReadyConsult = {
  userId: string
  clientId: string
  bookingId: string
  sessionId: string
}

const completeAnswers = {
  current_color: 'brunette',
  desired_color: 'red',
  change_scale: 'noticeable',
  box_dye_history: 'over-12-months',
  prior_lightening: '6-12-months',
  last_color_service_timing: '1-3-months',
  prior_reaction: 'no',
}

function context(id: string) {
  return { params: { id } }
}

function captureContext(id: string, captureId: string) {
  return { params: { id, captureId } }
}

async function body(response: Response): Promise<Record<string, unknown>> {
  const parsed: unknown = await response.json()
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Expected response object.')
  }
  return { ...parsed }
}

function jsonRequest(path: string, value: Record<string, unknown>, method = 'POST') {
  return new Request(`http://test${path}`, {
    method,
    body: JSON.stringify(value),
  })
}

function validIssue(idempotencyKey: string, shotKey: string) {
  return {
    idempotencyKey,
    shotKey,
    shotPackVersion: HAIR_COLOR_CAPTURE_PACK_VERSION,
    schemaVersion: HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
    contentType: 'image/jpeg',
    sizeBytes: 100,
  }
}

async function createReadyConsult(label: string): Promise<ReadyConsult> {
  const user = await db.user.create({
    data: { email: `${tag}_${label}@example.com`, password: 'x', role: Role.CLIENT },
    select: { id: true },
  })
  userIds.push(user.id)
  const client = await db.clientProfile.create({
    data: {
      userId: user.id,
      firstName: 'Capture',
      lastName: label,
      homeTenantId: tenantId,
    },
    select: { id: true },
  })
  clientIds.push(client.id)
  bookingSequence += 1
  const booking = await db.booking.create({
    data: {
      clientId: client.id,
      professionalId,
      serviceId,
      proTenantId: tenantId,
      clientHomeTenantId: tenantId,
      scheduledFor: new Date(future.getTime() + bookingSequence * 60 * 60 * 1000),
      status: BookingStatus.ACCEPTED,
      locationType: ServiceLocationType.SALON,
      locationId,
      locationTimeZone: 'America/Los_Angeles',
      subtotalSnapshot: new Prisma.Decimal('100.00'),
      totalAmount: new Prisma.Decimal('100.00'),
      totalDurationMinutes: 60,
    },
    select: { id: true },
  })
  bookingIds.push(booking.id)
  const session = await db.consultSession.create({
    data: {
      clientId: client.id,
      bookingId: booking.id,
      professionalId,
      serviceCategoryId: categoryId,
      auditEvents: {
        create: {
          action: ConsultAuditAction.SESSION_CREATED,
          actorType: ConsultActorType.CLIENT,
          actorId: user.id,
          toStatus: ConsultSessionStatus.CONSENT_REQUIRED,
        },
      },
    },
    select: { id: true },
  })
  sessionIds.push(session.id)

  await acceptConsultAgreement({
    consultSessionId: session.id,
    agreementVersionId: consentVersionId,
    expectedKind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
    actor: { type: ConsultActorType.CLIENT, id: user.id },
  })
  await acceptConsultAgreement({
    consultSessionId: session.id,
    agreementVersionId: adultVersionId,
    expectedKind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
    actor: { type: ConsultActorType.CLIENT, id: user.id },
  })
  await appendHairColorIntakeRevision({
    consultSessionId: session.id,
    actor: { type: ConsultActorType.CLIENT, id: user.id },
    loadInput: async () => ({
      idempotencyKey: `complete-${label}`,
      packVersion: HAIR_COLOR_INTAKE_PACK_VERSION,
      schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
      complete: true,
      answers: completeAnswers,
    }),
  })
  return { userId: user.id, clientId: client.id, bookingId: booking.id, sessionId: session.id }
}

function authenticate(consult: ReadyConsult) {
  mockRequireClient.mockResolvedValue({
    ok: true,
    clientId: consult.clientId,
    user: { id: consult.userId },
  })
}

async function issue(
  consult: ReadyConsult,
  shotKey: HairColorCaptureShotKey,
  key: string,
  options: { sizeBytes?: number; checksumSha256?: string } = {},
) {
  const request = jsonRequest(`/api/v1/client/consult/${consult.sessionId}/capture/uploads`, {
    idempotencyKey: key,
    shotKey,
    shotPackVersion: HAIR_COLOR_CAPTURE_PACK_VERSION,
    schemaVersion: HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
    contentType: 'image/jpeg',
    sizeBytes: options.sizeBytes ?? 100,
    ...(options.checksumSha256 ? { checksumSha256: options.checksumSha256 } : {}),
  })
  return issueUpload(request, context(consult.sessionId))
}

async function putIssuedObject(uploadSessionId: string) {
  const upload = await db.uploadSession.findUniqueOrThrow({
    where: { id: uploadSessionId },
  })
  fake.objects.set(upload.storagePath, {
    contentType: 'image/jpeg',
    sizeBytes: upload.maxBytes,
    checksumSha256: upload.checksumSha256,
  })
  return upload
}

async function attach(
  consult: ReadyConsult,
  uploadSessionId: string,
  shotKey: HairColorCaptureShotKey,
  key: string,
) {
  return attachCapture(
    jsonRequest(`/api/v1/client/consult/${consult.sessionId}/capture/attach`, {
      idempotencyKey: key,
      uploadSessionId,
      shotKey,
      shotPackVersion: HAIR_COLOR_CAPTURE_PACK_VERSION,
      schemaVersion: HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
    }),
    context(consult.sessionId),
  )
}

async function quality(
  consult: ReadyConsult,
  captureId: string,
  key: string,
) {
  return checkQuality(
    jsonRequest(`/api/v1/client/consult/${consult.sessionId}/capture/${captureId}/quality`, {
      idempotencyKey: key,
      shotPackVersion: HAIR_COLOR_CAPTURE_PACK_VERSION,
      schemaVersion: HAIR_COLOR_CAPTURE_SCHEMA_VERSION,
    }),
    captureContext(consult.sessionId, captureId),
  )
}

async function issueAttach(
  consult: ReadyConsult,
  shotKey: HairColorCaptureShotKey,
  suffix: string,
) {
  const issued = await issue(consult, shotKey, `issue-${suffix}`)
  const issuedBody = await body(issued)
  const upload = issuedBody.upload as { uploadSessionId: string }
  await putIssuedObject(upload.uploadSessionId)
  const attached = await attach(
    consult,
    upload.uploadSessionId,
    shotKey,
    `attach-${suffix}`,
  )
  const attachedBody = await body(attached)
  return attachedBody.captureId as string
}

beforeAll(async () => {
  process.env.ENABLE_AI_CONSULT = '1'
  const tenant = await db.tenant.create({
    data: { slug: `${tag}-tenant`, name: 'Capture integration', isActive: true },
    select: { id: true },
  })
  tenantId = tenant.id
  const proUser = await db.user.create({
    data: { email: `${tag}_pro@example.com`, password: 'x', role: Role.PRO },
    select: { id: true },
  })
  proUserId = proUser.id
  const pro = await db.professionalProfile.create({
    data: {
      userId: proUser.id,
      homeTenantId: tenantId,
      firstName: 'Capture',
      lastName: 'Professional',
      timeZone: 'America/Los_Angeles',
    },
    select: { id: true },
  })
  professionalId = pro.id
  const location = await db.professionalLocation.create({
    data: {
      professionalId,
      type: ProfessionalLocationType.SALON,
      name: 'Capture studio',
      timeZone: 'America/Los_Angeles',
      workingHours: {},
    },
    select: { id: true },
  })
  locationId = location.id
  const category = await db.serviceCategory.create({
    data: { name: `${tag} hair color`, slug: 'hair-color' },
    select: { id: true },
  })
  categoryId = category.id
  const service = await db.service.create({
    data: {
      name: `${tag} color`,
      categoryId,
      defaultDurationMinutes: 60,
      minPrice: new Prisma.Decimal('100.00'),
    },
    select: { id: true },
  })
  serviceId = service.id
  const [consent, adult] = await Promise.all([
    db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        version: versionBase,
        title: 'Explicit capture consent fixture',
        body: 'Explicit capture consent fixture only.',
      },
      select: { id: true },
    }),
    db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.ADULT_18_PLUS_ATTESTATION,
        version: versionBase,
        title: 'Explicit capture adult fixture',
        body: 'Explicit capture adult fixture only.',
      },
      select: { id: true },
    }),
  ])
  consentVersionId = consent.id
  adultVersionId = adult.id
})

beforeEach(() => {
  vi.clearAllMocks()
  fake.objects.clear()
  fake.signedPaths.length = 0
  fake.purgedPaths.length = 0
  fake.failPurgePaths.clear()
  fake.qualityByShot.clear()
  fake.modelCalls.length = 0
})

afterAll(async () => {
  for (const sessionId of sessionIds) {
    await purgeConsultSessionRawObjects(sessionId)
  }
  await db.consultSession.deleteMany({ where: { id: { in: sessionIds } } })
  await db.consultAgreementVersion.deleteMany({
    where: { id: { in: [consentVersionId, adultVersionId] } },
  })
  await db.booking.deleteMany({ where: { id: { in: bookingIds } } })
  await db.professionalLocation.deleteMany({ where: { id: locationId } })
  await db.service.deleteMany({ where: { id: serviceId } })
  await db.serviceCategory.deleteMany({ where: { id: categoryId } })
  await db.clientProfile.deleteMany({ where: { id: { in: clientIds } } })
  await db.professionalProfile.deleteMany({ where: { id: professionalId } })
  await db.user.deleteMany({ where: { id: { in: [...userIds, proUserId] } } })
  await db.tenant.deleteMany({ where: { id: tenantId } })
  delete process.env.ENABLE_AI_CONSULT
  await db.$disconnect()
})

describe('consult C3 capture API against PostgreSQL and fake private storage', () => {
  it('returns the exact bounded shot pack only after both current prerequisites', async () => {
    const consult = await createReadyConsult('pack')
    authenticate(consult)
    const response = await getCapture(
      new Request(`http://test/api/v1/client/consult/${consult.sessionId}/capture`),
      context(consult.sessionId),
    )
    expect(response.status).toBe(200)
    expect(await body(response)).toMatchObject({
      capture: {
        consultId: consult.sessionId,
        status: ConsultSessionStatus.MEDIA_READY,
        shotPack: {
          id: 'hair-color-daylight',
          version: 1,
          schemaVersion: 1,
          shots: [
            { key: 'hair_back', requirement: 'REQUIRED' },
            { key: 'hair_left', requirement: 'REQUIRED' },
            { key: 'hair_right', requirement: 'REQUIRED' },
            { key: 'hair_crown', requirement: 'REQUIRED' },
          ],
        },
      },
    })
  })

  it('issues and attaches concurrently without duplicate rows or audits and validates the authoritative object', async () => {
    const consult = await createReadyConsult('idempotent')
    authenticate(consult)
    const checksum = 'a'.repeat(64)
    const [left, right] = await Promise.all([
      issue(consult, 'hair_back', 'same-issue', { checksumSha256: checksum }),
      issue(consult, 'hair_back', 'same-issue', { checksumSha256: checksum }),
    ])
    expect(left.status).toBe(200)
    expect(right.status).toBe(200)
    const leftBody = await body(left)
    const rightBody = await body(right)
    const leftUpload = leftBody.upload as { uploadSessionId: string; token: string; rawExpiresAt: string; expiresAt: string }
    const rightUpload = rightBody.upload as { uploadSessionId: string }
    expect(rightUpload.uploadSessionId).toBe(leftUpload.uploadSessionId)
    expect(leftUpload.token).toBe('signed-upload-secret')
    expect(
      new Date(leftUpload.rawExpiresAt).getTime() - new Date(leftUpload.expiresAt).getTime(),
    ).toBe(23 * 60 * 60 * 1000)
    const upload = await putIssuedObject(leftUpload.uploadSessionId)
    expect(upload.storageBucket).toBe('media-private')
    expect(upload.storagePath).toMatch(/^consult-raw\/v1\/[0-9a-f-]{36}\.jpg$/)
    expect(upload.storagePath).not.toContain(consult.clientId)
    expect(upload.storagePath).not.toContain(consult.sessionId)

    const [firstAttach, secondAttach] = await Promise.all([
      attach(consult, upload.id, 'hair_back', 'same-attach'),
      attach(consult, upload.id, 'hair_back', 'same-attach'),
    ])
    expect(firstAttach.status).toBe(200)
    expect(secondAttach.status).toBe(200)
    expect(
      await db.uploadSession.count({ where: { id: upload.id, status: UploadSessionStatus.CONSUMED } }),
    ).toBe(1)
    expect(
      await db.consultCapture.count({ where: { uploadSessionId: upload.id } }),
    ).toBe(1)
    expect(
      await db.consultAuditEvent.count({
        where: { consultSessionId: consult.sessionId, action: ConsultAuditAction.CAPTURE_UPLOAD_ISSUED },
      }),
    ).toBe(1)
    expect(
      await db.consultAuditEvent.count({
        where: { consultSessionId: consult.sessionId, action: ConsultAuditAction.CAPTURE_ATTACHED },
      }),
    ).toBe(1)

    const secondIssue = await issue(consult, 'hair_back', 'different-live-issue')
    const secondUploadId = ((await body(secondIssue)).upload as {
      uploadSessionId: string
    }).uploadSessionId
    await putIssuedObject(secondUploadId)
    const duplicateLive = await attach(
      consult,
      secondUploadId,
      'hair_back',
      'different-live-attach',
    )
    expect(duplicateLive.status).toBe(409)
    expect(
      await db.consultCapture.count({
        where: { consultSessionId: consult.sessionId, shotKey: 'hair_back' },
      }),
    ).toBe(1)
  })

  it('uses stable non-leaking upload failures for missing and foreign sessions', async () => {
    const owner = await createReadyConsult('upload-owner')
    const foreign = await createReadyConsult('upload-foreign')
    authenticate(foreign)
    const foreignIssue = await issue(foreign, 'hair_left', 'foreign-upload')
    const foreignUpload = (await body(foreignIssue)).upload as { uploadSessionId: string }
    await putIssuedObject(foreignUpload.uploadSessionId)

    authenticate(owner)
    const missing = await attach(owner, 'missing-session', 'hair_left', 'missing-attach')
    const stolen = await attach(owner, foreignUpload.uploadSessionId, 'hair_left', 'foreign-attach')
    expect(missing.status).toBe(409)
    expect(stolen.status).toBe(409)
    expect(await body(missing)).toMatchObject({ code: 'CONSULT_CAPTURE_UPLOAD_MISMATCH' })
    expect(await body(stolen)).toMatchObject({ code: 'CONSULT_CAPTURE_UPLOAD_MISMATCH' })
  })

  it('returns stable slot/version/idempotency/object/expiry failures without trusting client paths', async () => {
    const consult = await createReadyConsult('failures')
    authenticate(consult)
    const endpoint = `/api/v1/client/consult/${consult.sessionId}/capture/uploads`
    const invalidRequests = [
      [
        { ...validIssue('bad-pack', 'hair_back'), shotPackVersion: 99 },
        409,
        'CONSULT_CAPTURE_PACK_VERSION_MISMATCH',
      ],
      [
        { ...validIssue('bad-schema', 'hair_back'), schemaVersion: 99 },
        409,
        'CONSULT_CAPTURE_SCHEMA_VERSION_MISMATCH',
      ],
      [validIssue('bad-slot', 'brows_front'), 400, 'CONSULT_CAPTURE_INVALID_SLOT'],
    ] as const
    for (const [payload, status, code] of invalidRequests) {
      const response = await issueUpload(
        jsonRequest(endpoint, payload),
        context(consult.sessionId),
      )
      expect(response.status).toBe(status)
      expect(await body(response)).toMatchObject({ code })
    }

    const issued = await issue(consult, 'hair_back', 'conflicting-issue')
    expect(issued.status).toBe(200)
    const conflict = await issue(consult, 'hair_left', 'conflicting-issue')
    expect(conflict.status).toBe(409)
    expect(await body(conflict)).toMatchObject({ code: 'CONSULT_IDEMPOTENCY_CONFLICT' })

    const uploadSessionId = ((await body(issued)).upload as { uploadSessionId: string }).uploadSessionId
    const missingObject = await attach(
      consult,
      uploadSessionId,
      'hair_back',
      'missing-object',
    )
    expect(missingObject.status).toBe(422)
    expect(await body(missingObject)).toMatchObject({ code: 'CONSULT_CAPTURE_OBJECT_INVALID' })

    const upload = await putIssuedObject(uploadSessionId)
    await expect(
      attachConsultCaptureUpload({
        consultSessionId: consult.sessionId,
        clientId: consult.clientId,
        actor: { type: ConsultActorType.CLIENT, id: consult.userId },
        now: new Date(upload.expiresAt.getTime() + 1),
        loadInput: async () => ({
          idempotencyKey: 'expired-attach',
          uploadSessionId,
          shotKey: 'hair_back',
          shotPackVersion: 1,
          schemaVersion: 1,
        }),
      }),
    ).rejects.toMatchObject({ code: 'CAPTURE_UPLOAD_EXPIRED' })
  })

  it('fails closed on newly published agreement versions and founder disable before parsing capture input', async () => {
    const consult = await createReadyConsult('stale-agreement')
    authenticate(consult)
    const replacement = await db.consultAgreementVersion.create({
      data: {
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        version: versionBase + 1,
        title: 'Explicit newer capture consent fixture',
        body: 'Explicit newer capture consent fixture only.',
      },
      select: { id: true },
    })
    try {
      const staleRequest = jsonRequest(
        `/api/v1/client/consult/${consult.sessionId}/capture/uploads`,
        validIssue('stale-agreement', 'hair_back'),
      )
      const staleJson = vi.spyOn(staleRequest, 'json')
      const stale = await issueUpload(staleRequest, context(consult.sessionId))
      expect(stale.status).toBe(409)
      expect(await body(stale)).toMatchObject({ code: 'CONSULT_PREREQUISITES_REQUIRED' })
      expect(staleJson).not.toHaveBeenCalled()
    } finally {
      await db.consultAgreementVersion.delete({ where: { id: replacement.id } })
    }

    delete process.env.ENABLE_AI_CONSULT
    const darkRequest = jsonRequest(
      `/api/v1/client/consult/${consult.sessionId}/capture/uploads`,
      validIssue('dark', 'hair_back'),
    )
    const darkJson = vi.spyOn(darkRequest, 'json')
    const dark = await issueUpload(darkRequest, context(consult.sessionId))
    process.env.ENABLE_AI_CONSULT = '1'
    expect(dark.status).toBe(404)
    expect(darkJson).not.toHaveBeenCalled()
  })

  it('hard-rejects warm light and color cast, purges immediately, and preserves replacement evidence', async () => {
    const consult = await createReadyConsult('replace')
    authenticate(consult)
    fake.qualityByShot.set('hair_left', {
      accepted: false,
      reasonCode: 'WARM_INDOOR_LIGHT',
      retakeTip: 'Face a window and turn off warm room lights.',
      model: 'fake-quality-model',
    })
    const rejectedId = await issueAttach(consult, 'hair_left', 'rejected')
    const [first, retry] = await Promise.all([
      quality(consult, rejectedId, 'same-quality'),
      quality(consult, rejectedId, 'same-quality'),
    ])
    expect(first.status).toBe(200)
    expect(retry.status).toBe(200)
    expect(fake.modelCalls).toEqual(['hair_left'])
    expect(await body(first)).toMatchObject({
      quality: {
        accepted: false,
        reasonCode: 'WARM_INDOOR_LIGHT',
        retakeTip: 'Face a window and turn off warm room lights.',
      },
    })
    const rejected = await db.consultCapture.findUniqueOrThrow({ where: { id: rejectedId } })
    expect(rejected.status).toBe(ConsultCaptureStatus.REJECTED)
    expect(rejected.storagePath).toBeNull()
    expect(rejected.purgedAt).not.toBeNull()

    fake.qualityByShot.set('hair_left', {
      accepted: true,
      reasonCode: 'PASS',
      retakeTip: null,
      model: 'fake-quality-model',
    })
    const replacementId = await issueAttach(consult, 'hair_left', 'replacement')
    expect((await quality(consult, replacementId, 'replacement-quality')).status).toBe(200)
    expect(
      await db.consultAuditEvent.count({
        where: { captureId: rejectedId, action: ConsultAuditAction.CAPTURE_QUALITY_CHECKED },
      }),
    ).toBe(1)
    expect(
      await db.consultAuditEvent.count({
        where: { captureId: rejectedId, action: ConsultAuditAction.RAW_OBJECT_PURGED },
      }),
    ).toBe(1)

    const colorCastConsult = await createReadyConsult('color-cast')
    authenticate(colorCastConsult)
    fake.qualityByShot.set('hair_back', {
      accepted: false,
      reasonCode: 'COLOR_CAST',
      retakeTip: 'Move into indirect daylight and remove colored reflections.',
      model: 'fake-quality-model',
    })
    const colorCastId = await issueAttach(
      colorCastConsult,
      'hair_back',
      'color-cast',
    )
    const colorCastResponse = await quality(
      colorCastConsult,
      colorCastId,
      'color-cast-quality',
    )
    expect(await body(colorCastResponse)).toMatchObject({
      quality: { accepted: false, reasonCode: 'COLOR_CAST' },
    })
    expect(
      await db.consultCapture.findUniqueOrThrow({
        where: { id: colorCastId },
        select: { purgedAt: true, storagePath: true },
      }),
    ).toMatchObject({ purgedAt: expect.any(Date), storagePath: null })
  })

  it('moves to ANALYSIS_PENDING exactly once after four accepted unexpired slots', async () => {
    const consult = await createReadyConsult('ready')
    authenticate(consult)
    for (const shotKey of ['hair_back', 'hair_left', 'hair_right', 'hair_crown'] as const) {
      const captureId = await issueAttach(consult, shotKey, `ready-${shotKey}`)
      const [first, retry] = await Promise.all([
        quality(consult, captureId, `quality-${shotKey}`),
        quality(consult, captureId, `quality-${shotKey}`),
      ])
      expect(first.status).toBe(200)
      expect(retry.status).toBe(200)
    }
    expect(fake.modelCalls.sort()).toEqual(
      ['hair_back', 'hair_crown', 'hair_left', 'hair_right'].sort(),
    )
    expect(
      await db.consultSession.findUniqueOrThrow({ where: { id: consult.sessionId }, select: { status: true } }),
    ).toEqual({ status: ConsultSessionStatus.ANALYSIS_PENDING })
    const transitions = await db.consultAuditEvent.findMany({
      where: {
        consultSessionId: consult.sessionId,
        action: ConsultAuditAction.LIFECYCLE_TRANSITIONED,
        fromStatus: ConsultSessionStatus.MEDIA_READY,
        toStatus: ConsultSessionStatus.ANALYSIS_PENDING,
      },
    })
    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toMatchObject({
      agreementAcceptanceId: null,
      revisionId: null,
      captureId: null,
    })
  })

  it('revocation fences later quality work and immediately purges raw objects', async () => {
    const consult = await createReadyConsult('revoke')
    authenticate(consult)
    const captureId = await issueAttach(consult, 'hair_right', 'revoke')
    const acceptance = await db.consultAgreementAcceptance.findFirstOrThrow({
      where: {
        consultSessionId: consult.sessionId,
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        revokedAt: null,
      },
    })
    await revokeConsultAgreement({
      consultSessionId: consult.sessionId,
      acceptanceId: acceptance.id,
      reason: 'Integration revocation fixture.',
      actor: { type: ConsultActorType.CLIENT, id: consult.userId },
    })
    await purgeConsultSessionRawObjects(consult.sessionId)

    const response = await quality(consult, captureId, 'after-revoke')
    expect(response.status).toBe(409)
    expect(await body(response)).toMatchObject({ code: 'CONSULT_PREREQUISITES_REQUIRED' })
    expect(fake.modelCalls).toHaveLength(0)
    expect(
      await db.consultCapture.findUniqueOrThrow({ where: { id: captureId }, select: { purgedAt: true, storagePath: true } }),
    ).toMatchObject({ storagePath: null, purgedAt: expect.any(Date) })
  })

  it('serializes a quality/revocation race and leaves no readable raw object', async () => {
    const consult = await createReadyConsult('revoke-race')
    authenticate(consult)
    const captureId = await issueAttach(consult, 'hair_left', 'revoke-race')
    const acceptance = await db.consultAgreementAcceptance.findFirstOrThrow({
      where: {
        consultSessionId: consult.sessionId,
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        revokedAt: null,
      },
    })

    const [qualityResponse] = await Promise.all([
      quality(consult, captureId, 'revoke-race-quality'),
      revokeConsultAgreement({
        consultSessionId: consult.sessionId,
        acceptanceId: acceptance.id,
        reason: 'Revocation race fixture.',
        actor: { type: ConsultActorType.CLIENT, id: consult.userId },
      }),
    ])
    expect([200, 409]).toContain(qualityResponse.status)
    await purgeConsultSessionRawObjects(consult.sessionId)
    expect(
      await db.consultSession.findUniqueOrThrow({
        where: { id: consult.sessionId },
        select: { status: true },
      }),
    ).toEqual({ status: ConsultSessionStatus.CONSENT_REVOKED })
    expect(
      await db.consultCapture.findUniqueOrThrow({
        where: { id: captureId },
        select: { purgedAt: true, storagePath: true },
      }),
    ).toMatchObject({ storagePath: null, purgedAt: expect.any(Date) })
    expect(fake.modelCalls.length).toBeLessThanOrEqual(1)
  })

  it('re-consent requires a fresh intake and permits only fresh raw captures', async () => {
    const consult = await createReadyConsult('reconsent')
    authenticate(consult)
    const oldCaptureId = await issueAttach(consult, 'hair_right', 'old-consent')
    const acceptance = await db.consultAgreementAcceptance.findFirstOrThrow({
      where: {
        consultSessionId: consult.sessionId,
        kind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
        revokedAt: null,
      },
    })
    await revokeConsultAgreement({
      consultSessionId: consult.sessionId,
      acceptanceId: acceptance.id,
      reason: 'Re-consent integration fixture.',
      actor: { type: ConsultActorType.CLIENT, id: consult.userId },
    })
    await purgeConsultSessionRawObjects(consult.sessionId)
    await acceptConsultAgreement({
      consultSessionId: consult.sessionId,
      agreementVersionId: consentVersionId,
      expectedKind: ConsultAgreementKind.SENSITIVE_DATA_CONSENT,
      actor: { type: ConsultActorType.CLIENT, id: consult.userId },
    })
    expect(
      await db.consultSession.findUniqueOrThrow({ where: { id: consult.sessionId }, select: { status: true } }),
    ).toEqual({ status: ConsultSessionStatus.INTAKE_READY })
    await appendHairColorIntakeRevision({
      consultSessionId: consult.sessionId,
      actor: { type: ConsultActorType.CLIENT, id: consult.userId },
      loadInput: async () => ({
        idempotencyKey: 'fresh-intake-after-reconsent',
        packVersion: HAIR_COLOR_INTAKE_PACK_VERSION,
        schemaVersion: HAIR_COLOR_INTAKE_SCHEMA_VERSION,
        complete: true,
        answers: completeAnswers,
      }),
    })
    const fresh = await issue(consult, 'hair_right', 'fresh-consent')
    expect(fresh.status).toBe(200)
    expect(
      await db.consultCapture.findUniqueOrThrow({ where: { id: oldCaptureId }, select: { purgedAt: true } }),
    ).toMatchObject({ purgedAt: expect.any(Date) })
  })

  it('direct cancellation makes attached raw objects immediately purge-eligible', async () => {
    const consult = await createReadyConsult('cancel')
    authenticate(consult)
    const captureId = await issueAttach(consult, 'hair_crown', 'cancel')
    await db.consultSession.update({
      where: { id: consult.sessionId },
      data: { status: ConsultSessionStatus.CANCELLED },
    })
    const marked = await db.consultCapture.findUniqueOrThrow({
      where: { id: captureId },
      select: { purgeEligibleAt: true },
    })
    expect(marked.purgeEligibleAt).not.toBeNull()
    await runConsultCapturePurgeSweep(new Date())
    expect(
      await db.consultCapture.findUniqueOrThrow({
        where: { id: captureId },
        select: { purgedAt: true, storagePath: true },
      }),
    ).toMatchObject({ purgedAt: expect.any(Date), storagePath: null })
  })

  it('purges an unattached upload immediately when its booking is cancelled', async () => {
    const consult = await createReadyConsult('booking-cancel')
    authenticate(consult)
    const issued = await issue(consult, 'hair_back', 'booking-cancel-pending')
    const uploadSessionId = ((await body(issued)).upload as {
      uploadSessionId: string
    }).uploadSessionId
    const upload = await putIssuedObject(uploadSessionId)

    await db.booking.update({
      where: { id: consult.bookingId },
      data: { status: BookingStatus.CANCELLED },
    })
    expect(
      await db.uploadSession.findUniqueOrThrow({
        where: { id: upload.id },
        select: { purgeEligibleAt: true },
      }),
    ).toMatchObject({ purgeEligibleAt: expect.any(Date) })
    expect(await runConsultCapturePurgeSweep(new Date())).toMatchObject({
      considered: 1,
      purged: 1,
      failed: 0,
    })
    expect(fake.objects.has(upload.storagePath)).toBe(false)
    expect(
      await db.uploadSession.findUniqueOrThrow({
        where: { id: upload.id },
        select: { status: true, purgedAt: true },
      }),
    ).toMatchObject({
      status: UploadSessionStatus.EXPIRED,
      purgedAt: expect.any(Date),
    })
  })

  it('retries verified scheduled purge and marks absent only after storage succeeds', async () => {
    const consult = await createReadyConsult('sweep')
    authenticate(consult)
    const issued = await issue(consult, 'hair_crown', 'abandoned')
    const uploadSessionId = ((await body(issued)).upload as { uploadSessionId: string }).uploadSessionId
    const upload = await putIssuedObject(uploadSessionId)
    fake.failPurgePaths.add(upload.storagePath)
    const futureSweep = new Date(upload.expiresAt.getTime() + 1)
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const first = await runConsultCapturePurgeSweep(futureSweep)
    expect(first.failed).toBe(1)
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(upload.storagePath)
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('signed-upload-secret')
    expect(
      await db.uploadSession.findUniqueOrThrow({ where: { id: upload.id }, select: { purgedAt: true } }),
    ).toEqual({ purgedAt: null })

    const second = await runConsultCapturePurgeSweep(futureSweep)
    expect(second).toMatchObject({ considered: 1, purged: 1, failed: 0 })
    errorLog.mockRestore()
    expect(fake.objects.has(upload.storagePath)).toBe(false)
    expect(
      await db.uploadSession.findUniqueOrThrow({
        where: { id: upload.id },
        select: { status: true, purgedAt: true, storageBucket: true, storagePath: true },
      }),
    ).toMatchObject({
      status: UploadSessionStatus.EXPIRED,
      purgedAt: expect.any(Date),
      storageBucket: 'purged',
      storagePath: `purged/${upload.id}`,
    })
  })

  it('client deletion purges bytes, retains content-free evidence, and never creates MediaAsset', async () => {
    const consult = await createReadyConsult('delete')
    authenticate(consult)
    const captureId = await issueAttach(consult, 'hair_back', 'delete')
    const mediaBefore = await db.mediaAsset.count()
    const response = await deleteCapture(
      new Request(`http://test/api/v1/client/consult/${consult.sessionId}/capture/${captureId}`, { method: 'DELETE' }),
      captureContext(consult.sessionId, captureId),
    )
    expect(response.status).toBe(200)
    expect(await body(response)).toMatchObject({ deleted: true })
    expect(await db.mediaAsset.count()).toBe(mediaBefore)
    const capture = await db.consultCapture.findUniqueOrThrow({ where: { id: captureId } })
    expect(capture.storageBucket).toBeNull()
    expect(capture.storagePath).toBeNull()
    expect(capture.purgedAt).not.toBeNull()
    const serializedAudit = JSON.stringify(
      await db.consultAuditEvent.findMany({ where: { captureId } }),
    )
    expect(serializedAudit).not.toContain('consult-raw')
    expect(serializedAudit).not.toContain('signed-upload-secret')
    expect(serializedAudit).not.toContain('fake-quality-model')
  })

  it('enforces RLS and rejects direct capture rows without an exact server-minted binding', async () => {
    const rls = await db.$queryRaw<Array<{ relrowsecurity: boolean }>>(Prisma.sql`
      SELECT relrowsecurity FROM pg_class WHERE oid = '"ConsultCapture"'::regclass
    `)
    expect(rls).toEqual([{ relrowsecurity: true }])

    const consult = await createReadyConsult('direct-db')
    await expect(
      db.consultCapture.create({
        data: {
          consultSessionId: consult.sessionId,
          uploadSessionId: 'forged-upload',
          shotKey: 'hair_back',
          shotPackVersion: 1,
          schemaVersion: 1,
          storageBucket: 'media-private',
          storagePath: 'consult-raw/v1/00000000-0000-0000-0000-000000000000.jpg',
          contentType: 'image/jpeg',
          sizeBytes: 100,
          attachIdempotencyKey: 'forged-attach',
          attachRequestHash: 'f'.repeat(64),
          rawExpiresAt: new Date(Date.now() + 60_000),
        },
      }),
    ).rejects.toThrow()

    await expect(
      db.consultSession.update({
        where: { id: consult.sessionId },
        data: { status: ConsultSessionStatus.ANALYSIS_PENDING },
      }),
    ).rejects.toThrow()

    authenticate(consult)
    const pendingResponse = await issue(consult, 'hair_left', 'direct-pending')
    const pendingUpload = (await body(pendingResponse)).upload as {
      uploadSessionId: string
    }
    await expect(
      db.uploadSession.update({
        where: { id: pendingUpload.uploadSessionId },
        data: { status: UploadSessionStatus.CONSUMED, consumedAt: new Date() },
      }),
    ).rejects.toThrow()

    const captureId = await issueAttach(consult, 'hair_right', 'direct-quality')
    await expect(
      db.consultCapture.update({
        where: { id: captureId },
        data: {
          status: ConsultCaptureStatus.ACCEPTED,
          qualityReasonCode: 'PASS',
          qualitySchemaVersion: 1,
          qualityPromptVersion: 'unversioned-direct-write',
          qualityModel: 'direct-write',
          qualityCheckedAt: new Date(),
          qualityIdempotencyKey: 'direct-quality',
          qualityRequestHash: 'a'.repeat(64),
        },
      }),
    ).rejects.toThrow()
    const attached = await db.consultCapture.findUniqueOrThrow({
      where: { id: captureId },
      select: { uploadSessionId: true },
    })
    await expect(
      db.uploadSession.delete({ where: { id: attached.uploadSessionId } }),
    ).rejects.toThrow()
  })
})

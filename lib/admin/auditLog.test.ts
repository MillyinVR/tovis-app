// lib/admin/auditLog.test.ts

import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  adminActionLogCreate: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    adminActionLog: {
      create: mocks.adminActionLogCreate,
    },
  },
}))

import { writeAdminAuditLog } from './auditLog'

describe('writeAdminAuditLog', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    mocks.adminActionLogCreate.mockResolvedValue({
      id: 'audit_1',
      adminUserId: 'admin_1',
      action: 'service.update',
      note: null,
      serviceId: null,
      categoryId: null,
      professionalId: null,
      createdAt: new Date('2026-05-31T12:00:00.000Z'),
    })
  })

  it('requires adminUserId', async () => {
    await expect(
      writeAdminAuditLog({
        adminUserId: '   ',
        action: 'service.update',
      }),
    ).rejects.toThrow('admin/auditLog: adminUserId is required.')

    expect(mocks.adminActionLogCreate).not.toHaveBeenCalled()
  })

  it('requires action', async () => {
    await expect(
      writeAdminAuditLog({
        adminUserId: 'admin_1',
        action: '   ',
      }),
    ).rejects.toThrow('admin/auditLog: action is required.')

    expect(mocks.adminActionLogCreate).not.toHaveBeenCalled()
  })

  it('stores typed target ids directly and omits note when there is no extra context', async () => {
    await writeAdminAuditLog({
      adminUserId: ' admin_1 ',
      action: ' service.update ',
      serviceId: ' service_1 ',
      categoryId: ' category_1 ',
      professionalId: ' pro_1 ',
    })

    expect(mocks.adminActionLogCreate).toHaveBeenCalledWith({
      data: {
        adminUserId: 'admin_1',
        action: 'service.update',
        serviceId: 'service_1',
        categoryId: 'category_1',
        professionalId: 'pro_1',
        note: null,
      },
      select: {
        id: true,
        adminUserId: true,
        action: true,
        note: true,
        serviceId: true,
        categoryId: true,
        professionalId: true,
        createdAt: true,
      },
    })
  })

  it('redacts note and sensitive audit payload fields before persistence', async () => {
    await writeAdminAuditLog({
      adminUserId: 'admin_1',
      action: 'professional.review',
      targetType: 'professional',
      targetId: 'pro_1',
      note: 'Client email is client@example.com and phone is 555-111-2222',
      oldValue: {
        email: 'old@example.com',
        phone: '+15551112222',
        publicLabel: 'Old public label',
      },
      newValue: {
        email: 'new@example.com',
        phone: '+15553334444',
        publicLabel: 'New public label',
        nested: {
          token: 'secret-token',
          safeCount: 2,
        },
      },
      metadata: {
        ip: '203.0.113.10',
        userAgent: 'Vitest Browser',
        reason: 'manual review',
      },
    })

    const call = mocks.adminActionLogCreate.mock.calls[0]?.[0] as {
      data: {
        note: string | null
      }
    }

    expect(call.data.note).not.toBeNull()

    const parsed = JSON.parse(call.data.note ?? '{}') as {
      note?: unknown
      targetType?: unknown
      targetId?: unknown
      oldValue?: Record<string, unknown>
      newValue?: {
        nested?: Record<string, unknown>
      } & Record<string, unknown>
      metadata?: Record<string, unknown>
    }

    expect(parsed.note).toBe('[REDACTED]')
    expect(parsed.targetType).toBe('professional')
    expect(parsed.targetId).toBe('pro_1')

    expect(JSON.stringify(parsed)).not.toContain('client@example.com')
    expect(JSON.stringify(parsed)).not.toContain('555-111-2222')
    expect(JSON.stringify(parsed)).not.toContain('old@example.com')
    expect(JSON.stringify(parsed)).not.toContain('+15551112222')
    expect(JSON.stringify(parsed)).not.toContain('new@example.com')
    expect(JSON.stringify(parsed)).not.toContain('+15553334444')
    expect(JSON.stringify(parsed)).not.toContain('secret-token')

    expect(parsed.oldValue?.publicLabel).toBe('Old public label')
    expect(parsed.newValue?.publicLabel).toBe('New public label')
    expect(parsed.newValue?.nested?.safeCount).toBe(2)
    expect(parsed.metadata?.reason).toBe('manual review')
  })

  it('uses a provided transaction client when supplied', async () => {
    const txCreate = vi.fn().mockResolvedValue({
        id: 'audit_tx_1',
        adminUserId: 'admin_1',
        action: 'category.update',
        note: null,
        serviceId: null,
        categoryId: 'category_1',
        professionalId: null,
        createdAt: new Date('2026-05-31T12:00:00.000Z'),
        })

        const tx = {
        adminActionLog: {
            create: txCreate,
        },
        } as unknown as Prisma.TransactionClient

        const result = await writeAdminAuditLog({
        adminUserId: 'admin_1',
        action: 'category.update',
        categoryId: 'category_1',
        tx,
        })

    expect(txCreate).toHaveBeenCalledTimes(1)
    expect(mocks.adminActionLogCreate).not.toHaveBeenCalled()

    expect(result).toEqual({
      id: 'audit_tx_1',
      adminUserId: 'admin_1',
      action: 'category.update',
      note: null,
      serviceId: null,
      categoryId: 'category_1',
      professionalId: null,
      createdAt: new Date('2026-05-31T12:00:00.000Z'),
    })
  })
})
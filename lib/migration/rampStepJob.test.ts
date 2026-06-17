// lib/migration/rampStepJob.test.ts
//
// Tests the ramp step job's load → advance → persist orchestration with a mocked
// Prisma. The step math itself is covered by priceRamp.test (advanceRamp).

import { Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    offeringPriceRamp: {
      findMany: mocks.findMany,
      update: mocks.update,
    },
  },
}))

import { runRampStep } from './rampStepJob'

const NOW = new Date('2026-09-01T08:00:00.000Z')
const PAST = new Date('2026-08-30T08:00:00.000Z') // due (before NOW)

type UpdateArgs = {
  where: { id: string }
  data: { currentPrice: Prisma.Decimal; nextStepAt: Date; completedAt: Date | null }
}

function dueRamp(overrides: {
  id: string
  currentPrice: number
  targetPrice: number
  stepValue?: number
}) {
  return {
    id: overrides.id,
    currentPrice: new Prisma.Decimal(overrides.currentPrice),
    targetPrice: new Prisma.Decimal(overrides.targetPrice),
    stepMode: 'PCT' as const,
    stepValue: new Prisma.Decimal(overrides.stepValue ?? 10),
    cadenceWeeks: 1,
    nextStepAt: PAST,
    completedAt: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.update.mockResolvedValue({})
  mocks.findMany.mockResolvedValue([])
})

describe('runRampStep', () => {
  it('queries only due, incomplete ramps and reports an empty run when none are due', async () => {
    const summary = await runRampStep({ now: NOW })

    expect(mocks.findMany).toHaveBeenCalledTimes(1)
    expect(mocks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { completedAt: null, nextStepAt: { lte: NOW } },
        orderBy: { nextStepAt: 'asc' },
      }),
    )
    expect(mocks.update).not.toHaveBeenCalled()
    expect(summary).toMatchObject({ scanned: 0, updated: 0, completed: 0, failed: 0 })
    expect(summary.scannedAt).toBe(NOW.toISOString())
  })

  it('advances a below-target ramp and persists the stepped price without completing it', async () => {
    const recorded: UpdateArgs[] = []
    mocks.update.mockImplementation((args: UpdateArgs) => {
      recorded.push(args)
      return Promise.resolve({})
    })
    mocks.findMany.mockResolvedValueOnce([dueRamp({ id: 'r1', currentPrice: 30, targetPrice: 50 })])

    const summary = await runRampStep({ now: NOW })

    // 30 → round(30 * 1.1) = 33, still below the 50 target.
    expect(recorded).toHaveLength(1)
    expect(recorded[0]?.where.id).toBe('r1')
    expect(recorded[0]?.data.currentPrice.toNumber()).toBe(33)
    expect(recorded[0]?.data.completedAt).toBeNull()
    expect(recorded[0]?.data.nextStepAt.getTime()).toBeGreaterThan(PAST.getTime())
    expect(summary).toMatchObject({ scanned: 1, updated: 1, completed: 0, failed: 0 })
  })

  it('completes a ramp that reaches the catalog minimum (clamped to target)', async () => {
    const recorded: UpdateArgs[] = []
    mocks.update.mockImplementation((args: UpdateArgs) => {
      recorded.push(args)
      return Promise.resolve({})
    })
    mocks.findMany.mockResolvedValueOnce([dueRamp({ id: 'r2', currentPrice: 48, targetPrice: 50 })])

    const summary = await runRampStep({ now: NOW })

    // 48 → round(52.8) = 53, clamped down to the 50 target → completed.
    expect(recorded[0]?.data.currentPrice.toNumber()).toBe(50)
    expect(recorded[0]?.data.completedAt).toBeInstanceOf(Date)
    expect(summary).toMatchObject({ scanned: 1, updated: 1, completed: 1, failed: 0 })
  })

  it('counts a failed row, keeps going, and does not abort the run', async () => {
    mocks.update
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({})
    mocks.findMany.mockResolvedValueOnce([
      dueRamp({ id: 'bad', currentPrice: 30, targetPrice: 50 }),
      dueRamp({ id: 'ok', currentPrice: 30, targetPrice: 50 }),
    ])
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    try {
      const summary = await runRampStep({ now: NOW })
      expect(summary).toMatchObject({ scanned: 2, updated: 1, failed: 1 })
      expect(errorSpy).toHaveBeenCalled()
    } finally {
      errorSpy.mockRestore()
    }
  })

  it('drains across batches when a full batch is returned', async () => {
    mocks.findMany
      .mockResolvedValueOnce([dueRamp({ id: 'a', currentPrice: 30, targetPrice: 50 })])
      .mockResolvedValueOnce([dueRamp({ id: 'b', currentPrice: 30, targetPrice: 50 })])
      .mockResolvedValue([])

    const summary = await runRampStep({ now: NOW, batchSize: 1 })

    // batchSize 1 + full batch → keeps querying until an empty batch.
    expect(mocks.findMany).toHaveBeenCalledTimes(3)
    expect(summary.scanned).toBe(2)
    expect(summary.updated).toBe(2)
  })
})

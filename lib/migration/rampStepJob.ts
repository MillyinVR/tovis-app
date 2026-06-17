// lib/migration/rampStepJob.ts
//
// The price-grace ramp step job. Loads ramps whose next step is due
// (completedAt IS NULL AND nextStepAt <= now — served by the
// @@index([completedAt, nextStepAt]) on OfferingPriceRamp) and walks each one
// forward via the canonical advanceRamp, persisting the new currentPrice /
// nextStepAt / completedAt. advanceRamp applies every step whose time has
// passed, so a missed run (or several) catches up in one pass.
//
// Processing a row pushes its nextStepAt into the future (or sets completedAt),
// so each batch query naturally excludes already-processed rows; the loop
// drains all due ramps. Best-effort per row: a single failure is logged and
// counted, never aborts the run.

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { clampInt } from '@/lib/pick'
import { safeError } from '@/lib/security/logging'

import { advanceRamp, type RampState } from './priceRamp'

const DEFAULT_BATCH_SIZE = 200
const MAX_BATCH_SIZE = 1000
// Guards against an unexpected non-draining loop (e.g. a persist that doesn't
// move nextStepAt). At DEFAULT_BATCH_SIZE this still covers 10k due ramps.
const MAX_BATCHES = 50

const DUE_RAMP_SELECT = {
  id: true,
  currentPrice: true,
  targetPrice: true,
  stepMode: true,
  stepValue: true,
  cadenceWeeks: true,
  nextStepAt: true,
  completedAt: true,
} satisfies Prisma.OfferingPriceRampSelect

export type RampStepSummary = {
  scanned: number // rows examined
  updated: number // rows successfully stepped + persisted
  completed: number // rows that reached the catalog minimum this run
  failed: number // rows that errored (logged, skipped)
  scannedAt: string
}

export async function runRampStep(args: {
  now: Date
  batchSize?: number
}): Promise<RampStepSummary> {
  const { now } = args
  const batchSize = clampInt(args.batchSize ?? DEFAULT_BATCH_SIZE, 1, MAX_BATCH_SIZE)

  let scanned = 0
  let updated = 0
  let completed = 0
  let failed = 0

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const due = await prisma.offeringPriceRamp.findMany({
      where: { completedAt: null, nextStepAt: { lte: now } },
      select: DUE_RAMP_SELECT,
      orderBy: { nextStepAt: 'asc' },
      take: batchSize,
    })

    if (due.length === 0) break

    for (const row of due) {
      scanned += 1
      try {
        const state: RampState = {
          currentPrice: row.currentPrice.toNumber(),
          targetPrice: row.targetPrice.toNumber(),
          stepMode: row.stepMode,
          stepValue: row.stepValue.toNumber(),
          cadenceWeeks: row.cadenceWeeks,
          nextStepAt: row.nextStepAt,
          completedAt: row.completedAt,
        }
        const next = advanceRamp(state, now)
        await prisma.offeringPriceRamp.update({
          where: { id: row.id },
          data: {
            currentPrice: new Prisma.Decimal(next.currentPrice),
            nextStepAt: next.nextStepAt,
            completedAt: next.completedAt,
          },
        })
        updated += 1
        if (next.completedAt) completed += 1
      } catch (error: unknown) {
        failed += 1
        console.error('rampStepJob: failed to advance ramp', {
          rampId: row.id,
          error: safeError(error),
        })
      }
    }

    if (due.length < batchSize) break
  }

  return { scanned, updated, completed, failed, scannedAt: now.toISOString() }
}

// lib/consult/providerMeter.ts
//
// One place every paid consult provider call reports what it spent.
//
// The design constraint that shapes this file: **metering must never be able
// to fail the thing it measures.** A consult that succeeded and then threw
// because a meter insert hit a constraint would be strictly worse than no
// meter at all — the client paid, the model answered, and the app lost the
// answer over bookkeeping. So `recordConsultProviderCall` swallows its own
// errors and logs them.
//
// The mirror-image risk is a meter that silently records nothing, which is
// exactly as invisible. Hence the console.error with a stable prefix: a
// consult whose cost lines are missing says so in the logs rather than simply
// showing $0.
//
// Call sites (all three, and the enum in the schema is the checklist):
//   CAPTURE_GATE       lib/consult/captureVision.ts
//   INSPIRATION_READ   lib/consult/inspirationVision.ts
//   ANALYSIS_PROFILE   lib/consult/analysisEngine.ts (call 1)
//   ANALYSIS_DIRECTION lib/consult/analysisEngine.ts (call 2)

// 🔴 NO `import 'server-only'` here, deliberately — the same rule as
// lib/prisma.ts, which does not carry it either. `analysisEngine.ts` imports
// this file, and `scripts/run-consult-evaluation.ts` imports the engine and
// runs under tsx, where `server-only` does not resolve
// (`Cannot find module 'server-only'`). Adding it passes every local check and
// breaks the CLI. What actually keeps this off the client is
// `check:no-client-prisma-import`, which follows the transitive import of
// `@/lib/prisma` below.

import {
  ConsultProviderCallKind,
  ConsultProviderCallOutcome,
} from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { safeError } from '@/lib/security/logging'

import {
  consultProviderCostMicroUsd,
  readConsultProviderUsage,
  type ConsultProviderUsage,
} from './providerCost'

/**
 * Where a metered call sends its row.
 *
 * `consultSessionId` is nullable at the seam because the provider engines are
 * pure functions over an image and a prompt — they do not, and should not,
 * know which consult they serve. The contract layer supplies the sink; when it
 * doesn't (unit tests, the eval script, the live schema test), the call simply
 * isn't metered rather than being attributed to nothing.
 */
export type ConsultProviderMeterSink = {
  consultSessionId: string
  analysisRunId?: string | null
}

export type ConsultProviderCallMeasurement = {
  kind: ConsultProviderCallKind
  outcome: ConsultProviderCallOutcome
  model: string
  latencyMs: number
  /** The provider's raw `usage` block. Absent for a call that never answered. */
  usage?: unknown
}

/** What a meter row looks like before it is written — exported for the tests. */
export type ConsultProviderCallRecord = ConsultProviderUsage & {
  kind: ConsultProviderCallKind
  outcome: ConsultProviderCallOutcome
  model: string
  latencyMs: number
  costMicroUsd: number | null
}

/** Pure: measurement in, row out. No I/O, so it is trivially testable. */
export function buildConsultProviderCallRecord(
  measurement: ConsultProviderCallMeasurement,
): ConsultProviderCallRecord {
  const usage = readConsultProviderUsage(measurement.usage)
  return {
    kind: measurement.kind,
    outcome: measurement.outcome,
    model: measurement.model,
    // A negative or non-finite duration is a clock artefact, not a measurement.
    latencyMs: Number.isFinite(measurement.latencyMs)
      ? Math.max(0, Math.round(measurement.latencyMs))
      : 0,
    ...usage,
    costMicroUsd: consultProviderCostMicroUsd(measurement.model, usage),
  }
}

/**
 * In-flight meter writes, so a caller can wait for them at a point where
 * waiting is safe. See `flushConsultProviderMeter`.
 */
const pendingWrites = new Set<Promise<void>>()

/**
 * Wait for every meter write started so far.
 *
 * 🔴 Call this only where NO transaction is open. Awaiting a meter write from
 * inside a transaction that holds `SELECT ... FOR UPDATE` on the ConsultSession
 * self-deadlocks: the write is a separate transaction, its foreign key to
 * ConsultSession makes Postgres take FOR KEY SHARE on that row, and FOR UPDATE
 * conflicts with it. Measured 2026-09-04 — it stalled a live capture gate for
 * the full 60s transaction budget and failed the request.
 *
 * That is the whole reason `meterConsultProviderCall` does not await its write.
 */
export async function flushConsultProviderMeter(): Promise<void> {
  // Two rounds: a write started by the last flush's own settlement still gets
  // waited on, without looping forever if something keeps enqueueing.
  for (let round = 0; round < 2 && pendingWrites.size > 0; round += 1) {
    await Promise.allSettled([...pendingWrites])
  }
}

/**
 * Persist one metered call. Fire-and-forget by contract: the returned promise
 * always resolves, and callers are free to ignore it.
 */
export async function recordConsultProviderCall(
  sink: ConsultProviderMeterSink | null | undefined,
  measurement: ConsultProviderCallMeasurement,
): Promise<void> {
  if (!sink?.consultSessionId) return

  const record = buildConsultProviderCallRecord(measurement)
  try {
    await prisma.consultProviderCall.create({
      data: {
        consultSessionId: sink.consultSessionId,
        analysisRunId: sink.analysisRunId ?? null,
        ...record,
      },
      select: { id: true },
    })
  } catch (error: unknown) {
    // Never rethrow: see the file header. A consult must not be lost to its
    // own accounting.
    console.error('consult provider meter: failed to record a paid call', {
      consultSessionId: sink.consultSessionId,
      analysisRunId: sink.analysisRunId ?? null,
      kind: measurement.kind,
      outcome: measurement.outcome,
      error: safeError(error),
    })
  }
}

/**
 * The three vision engines each throw their own error class, but all three
 * carry the same `kind` vocabulary. One mapper so a new engine cannot invent a
 * fourth spelling of "the model refused".
 */
export function consultProviderOutcomeForErrorKind(
  kind: unknown,
): ConsultProviderCallOutcome {
  switch (kind) {
    case 'refused':
      return ConsultProviderCallOutcome.REFUSED
    case 'bad_output':
    // An unreadable reference is a call that answered and whose answer this
    // repo could not use — the same money, the same category.
    case 'unreadable':
      return ConsultProviderCallOutcome.BAD_OUTPUT
    default:
      return ConsultProviderCallOutcome.UNAVAILABLE
  }
}

/**
 * Wrap ONE paid provider call so it is metered whatever happens to it.
 *
 * `run` is handed a `reportUsage` callback and must call it the moment the
 * provider answers — before any parsing, refusal check, or sanitizer. That
 * ordering is the whole point: a response that arrives and is then rejected by
 * this repo was still billed, and a meter that only counted the calls we liked
 * would under-report every failure mode we most want to see.
 */
export async function meterConsultProviderCall<T>(
  sink: ConsultProviderMeterSink | null | undefined,
  args: { kind: ConsultProviderCallKind; model: string },
  run: (reportUsage: (usage: unknown) => void) => Promise<T>,
): Promise<T> {
  const startedAt = Date.now()
  let usage: unknown = null
  const reportUsage = (value: unknown): void => {
    usage = value
  }

  // 🔴 NOT awaited, and this is load-bearing. Some paid calls run inside a
  // transaction that holds `FOR UPDATE` on the ConsultSession (the capture
  // gate does), and the meter row's foreign key to that same session makes the
  // insert wait for FOR KEY SHARE on the locked row. Awaiting it there is a
  // self-deadlock that burns the enclosing transaction's entire budget — it
  // did exactly that to a live capture gate on 2026-09-04. Un-awaited, the
  // insert simply queues behind the lock and lands the moment the transaction
  // commits. `flushConsultProviderMeter` is how a caller waits for it, at a
  // point where waiting is safe.
  const meter = (outcome: ConsultProviderCallOutcome) => {
    const write = recordConsultProviderCall(sink, {
      kind: args.kind,
      outcome,
      model: args.model,
      latencyMs: Date.now() - startedAt,
      usage,
    })
    pendingWrites.add(write)
    void write.finally(() => pendingWrites.delete(write))
  }

  try {
    const result = await run(reportUsage)
    meter(ConsultProviderCallOutcome.OK)
    return result
  } catch (error: unknown) {
    meter(
      consultProviderOutcomeForErrorKind(
        error && typeof error === 'object' && 'kind' in error
          ? (error as { kind: unknown }).kind
          : null,
      ),
    )
    throw error
  }
}

/**
 * Every metered call for one consult, oldest first, with the run each belongs
 * to. Read by the live end-to-end test's cost report and by operator tooling;
 * there is no client-facing surface for this.
 */
export async function readConsultProviderCalls(consultSessionId: string) {
  return prisma.consultProviderCall.findMany({
    where: { consultSessionId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      analysisRunId: true,
      kind: true,
      outcome: true,
      model: true,
      inputTokens: true,
      outputTokens: true,
      cacheCreationInputTokens: true,
      cacheReadInputTokens: true,
      latencyMs: true,
      costMicroUsd: true,
      createdAt: true,
    },
  })
}

// lib/observability/looksSocialJobEvents.ts
import type { LooksSocialJobPerTypeCounts } from '@/lib/jobs/looksSocial/contracts'

const APP_NAME = 'tovis-app'
const NAMESPACE = 'looks_social_jobs'

export type LooksSocialJobBatchEventLevel = 'info' | 'warn' | 'error'

export type LooksSocialJobBatchEventInput = {
  level: LooksSocialJobBatchEventLevel
  event: string
  route: string
  batchId: string
  method?: string
  take?: number
  processedAt?: string | null
  durationMs?: number | null
  scannedCount?: number
  processedCount?: number
  completedCount?: number
  retryScheduledCount?: number
  failedCount?: number
  perTypeCounts?: LooksSocialJobPerTypeCounts
  message?: string | null
  meta?: Record<string, unknown>
}

function sanitizeMeta(
  meta: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!meta) return {}

  const out: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(meta)) {
    if (value === undefined) continue
    out[key] = value
  }

  return out
}

function writeLine(
  level: LooksSocialJobBatchEventLevel,
  payload: Record<string, unknown>,
): void {
  const line = JSON.stringify(payload)

  if (level === 'info') {
    console.info(line)
    return
  }

  if (level === 'warn') {
    console.warn(line)
    return
  }

  console.error(line)
}

export function logLooksSocialJobBatchEvent(
  input: LooksSocialJobBatchEventInput,
): void {
  writeLine(input.level, {
    ts: new Date().toISOString(),
    app: APP_NAME,
    namespace: NAMESPACE,
    level: input.level,
    event: input.event,
    route: input.route,
    batchId: input.batchId,
    method: input.method ?? null,
    take: input.take ?? null,
    processedAt: input.processedAt ?? null,
    durationMs: input.durationMs ?? null,
    scannedCount: input.scannedCount ?? null,
    processedCount: input.processedCount ?? null,
    completedCount: input.completedCount ?? null,
    retryScheduledCount: input.retryScheduledCount ?? null,
    failedCount: input.failedCount ?? null,
    perTypeCounts: input.perTypeCounts ?? null,
    message: input.message ?? null,
    ...sanitizeMeta(input.meta),
  })
}
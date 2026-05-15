// lib/health/types.ts

export const HEALTH_SERVICE_NAME = 'tovis-app' as const

export const HEALTH_CHECK_NAMES = [
  'app',
  'postgres',
  'redis',
  'storage',
  'stripe',
  'postmark',
  'twilio',
] as const

export type HealthCheckName = (typeof HEALTH_CHECK_NAMES)[number]

export type HealthEndpoint = 'live' | 'ready'

export type HealthStatus = 'ok' | 'degraded' | 'down'

export type HealthCheckCriticality = 'critical' | 'degraded-only'

export type HealthCheckDetailValue =
  | string
  | number
  | boolean
  | null
  | readonly string[]
  | readonly number[]
  | readonly boolean[]

export type HealthCheckDetails = Readonly<
  Partial<Record<string, HealthCheckDetailValue>>
>

export type HealthCheckResult = Readonly<{
  name: HealthCheckName
  status: HealthStatus
  latencyMs: number
  checkedAt: string
  message?: string
  details?: HealthCheckDetails
}>

export type HealthChecks = Readonly<
  Partial<Record<HealthCheckName, HealthCheckResult>>
>

export type HealthResponse = Readonly<{
  service: typeof HEALTH_SERVICE_NAME
  endpoint: HealthEndpoint
  status: HealthStatus
  timestamp: string
  durationMs: number
  checks: HealthChecks
}>

export type HealthProbe = () => Promise<HealthCheckResult>

export type HealthProbeConfig = Readonly<{
  name: HealthCheckName
  criticality: HealthCheckCriticality
  timeoutMs: number
}>

export type HealthReadyOptions = Readonly<{
  degradedReturns503: boolean
  providerLiveChecksEnabled: boolean
}>

export type HealthRouteResult = Readonly<{
  response: HealthResponse
  statusCode: number
}>

export const HEALTH_STATUS_PRIORITY: Readonly<Record<HealthStatus, number>> = {
  ok: 0,
  degraded: 1,
  down: 2,
} as const

export const READY_CHECK_CRITICALITY: Readonly<
  Record<Exclude<HealthCheckName, 'app'>, HealthCheckCriticality>
> = {
  postgres: 'critical',
  redis: 'degraded-only',
  storage: 'degraded-only',
  stripe: 'degraded-only',
  postmark: 'degraded-only',
  twilio: 'degraded-only',
} as const

export const DEFAULT_HEALTH_TIMEOUT_MS = 2_000

export const DEFAULT_PROVIDER_HEALTH_TIMEOUT_MS = 3_000
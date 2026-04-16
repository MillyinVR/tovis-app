// lib/runtimeFlags.ts
import { getRedis, requireRedis } from '@/lib/redis'

export const RUNTIME_FLAG_NAMES = ['signup_disabled', 'sms_disabled'] as const

export type RuntimeFlagName = (typeof RUNTIME_FLAG_NAMES)[number]

export type RuntimeFlagsSnapshot = Record<RuntimeFlagName, boolean> & {
  backendAvailable: boolean
}

const RUNTIME_FLAGS_KEY = 'runtime_flags:v1'

function defaultFlags(): Record<RuntimeFlagName, boolean> {
  return {
    signup_disabled: false,
    sms_disabled: false,
  }
}

function normalizeStoredBoolean(value: unknown): boolean {
  if (value === true || value === 1) return true
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    return normalized === '1' || normalized === 'true'
  }
  return false
}

export async function getRuntimeFlags(): Promise<RuntimeFlagsSnapshot> {
  const defaults = defaultFlags()
  const redis = getRedis()

  if (!redis) {
    return { ...defaults, backendAvailable: false }
  }

  try {
    const raw = await redis.hgetall<Record<string, unknown>>(RUNTIME_FLAGS_KEY)

    return {
      signup_disabled: normalizeStoredBoolean(raw?.signup_disabled),
      sms_disabled: normalizeStoredBoolean(raw?.sms_disabled),
      backendAvailable: true,
    }
  } catch {
    return { ...defaults, backendAvailable: false }
  }
}

export async function isRuntimeFlagEnabled(name: RuntimeFlagName): Promise<boolean> {
  const flags = await getRuntimeFlags()
  return flags[name]
}

export async function setRuntimeFlag(
  name: RuntimeFlagName,
  enabled: boolean,
): Promise<void> {
  const redis = requireRedis()
  await redis.hset(RUNTIME_FLAGS_KEY, {
    [name]: enabled ? '1' : '0',
  })
}
// scripts/smoke.ts
//
// Fast post-deploy smoke test. Hits the critical paths on a deployed URL and
// reports pass/fail/skip per check as a JSON summary, so it can gate a
// rollback decision without a human clicking through the app.
//
//   SMOKE_BASE_URL=https://www.tovis.app pnpm smoke
//
// Safe to run against ANY environment, including production: the signup and
// login checks only exercise the earliest request-validation branch of each
// route (missing-field checks that run before any database read or write —
// see app/api/v1/auth/register/route.ts and app/api/v1/auth/login/route.ts),
// so by default this script performs zero writes. Every other check is a
// plain GET. The optional real-login check (SMOKE_LOGIN_EMAIL /
// SMOKE_LOGIN_PASSWORD) is the one exception — it performs a real login,
// which writes to the target user's login-attempt state exactly as a normal
// login would. Only set those against a non-prod target with a dedicated
// smoke-test account (e.g. the seeded client from `pnpm loadproof:fixtures`).

import { performance } from 'node:perf_hooks'

import { vercelBypassHeaders } from '../tests/load/_vercelBypass'

type CheckStatus = 'passed' | 'failed' | 'skipped'

type CheckResult = {
  name: string
  status: CheckStatus
  durationMs: number
  detail: string
  missingEnv?: string[]
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required.`)
  }
  return value
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) return fallback
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`)
  }
  return parsed
}

function jsonHeaders(baseUrl: string): HeadersInit {
  const origin = new URL(baseUrl).origin
  return {
    accept: 'application/json',
    'content-type': 'application/json',
    origin,
    referer: `${origin}/`,
    ...vercelBypassHeaders(),
  }
}

function htmlHeaders(baseUrl: string): HeadersInit {
  const origin = new URL(baseUrl).origin
  return {
    accept: 'text/html',
    referer: `${origin}/`,
    ...vercelBypassHeaders(),
  }
}

async function timedFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; bodyText: string; durationMs: number }> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const startedAt = performance.now()

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const bodyText = await response.text().catch(() => '')
    return { response, bodyText, durationMs: performance.now() - startedAt }
  } finally {
    clearTimeout(timeout)
  }
}

type CheckContext = {
  baseUrl: string
  timeoutMs: number
}

type Check = {
  name: string
  requiredEnv: readonly string[]
  run: (ctx: CheckContext) => Promise<Omit<CheckResult, 'name' | 'durationMs'>>
}

function missingEnv(names: readonly string[]): string[] {
  return names.filter((name) => !process.env[name]?.trim())
}

const CHECKS: readonly Check[] = [
  {
    name: 'health-live',
    requiredEnv: [],
    async run({ baseUrl, timeoutMs }) {
      const { response, durationMs } = await timedFetch(
        `${baseUrl}/api/health/live`,
        { method: 'GET', headers: jsonHeaders(baseUrl) },
        timeoutMs,
      )
      return response.status === 200
        ? { status: 'passed', detail: `HTTP ${response.status} in ${Math.round(durationMs)}ms` }
        : { status: 'failed', detail: `Expected HTTP 200, got ${response.status}` }
    },
  },
  {
    name: 'health-ready',
    requiredEnv: [],
    async run({ baseUrl, timeoutMs }) {
      const { response, bodyText } = await timedFetch(
        `${baseUrl}/api/health/ready`,
        { method: 'GET', headers: jsonHeaders(baseUrl) },
        timeoutMs,
      )
      let parsedStatus: string | null = null
      try {
        const parsed = JSON.parse(bodyText) as { status?: unknown }
        parsedStatus = typeof parsed.status === 'string' ? parsed.status : null
      } catch {
        // fall through — non-JSON body handled below
      }

      if (response.status >= 500) {
        return {
          status: 'failed',
          detail: `HTTP ${response.status}, status=${parsedStatus ?? 'unknown'}`,
        }
      }

      if (parsedStatus === 'down') {
        return { status: 'failed', detail: `HTTP ${response.status}, status=down` }
      }

      return {
        status: 'passed',
        detail: `HTTP ${response.status}, status=${parsedStatus ?? 'unknown'}`,
      }
    },
  },
  {
    name: 'signup-route-reachable',
    requiredEnv: [],
    async run({ baseUrl, timeoutMs }) {
      // Empty body trips the very first validation branch (missing
      // email/password/role) before any database access — see
      // app/api/v1/auth/register/route.ts. Proves the route is deployed and
      // parsing requests without creating an account anywhere, including prod.
      const { response, bodyText } = await timedFetch(
        `${baseUrl}/api/v1/auth/register`,
        { method: 'POST', headers: jsonHeaders(baseUrl), body: '{}' },
        timeoutMs,
      )
      const code = parseCode(bodyText)
      return response.status === 400 && code === 'MISSING_FIELDS'
        ? { status: 'passed', detail: `HTTP 400 code=${code}` }
        : {
            status: 'failed',
            detail: `Expected HTTP 400 code=MISSING_FIELDS, got HTTP ${response.status} code=${code ?? 'null'}`,
          }
    },
  },
  {
    name: 'login-route-reachable',
    requiredEnv: [],
    async run({ baseUrl, timeoutMs }) {
      // Empty body trips the first validation branch (missing
      // email/password) before any database access — see
      // app/api/v1/auth/login/route.ts. Zero writes, safe on prod.
      const { response, bodyText } = await timedFetch(
        `${baseUrl}/api/v1/auth/login`,
        { method: 'POST', headers: jsonHeaders(baseUrl), body: '{}' },
        timeoutMs,
      )
      const code = parseCode(bodyText)
      return response.status === 400 && code === 'MISSING_CREDENTIALS'
        ? { status: 'passed', detail: `HTTP 400 code=${code}` }
        : {
            status: 'failed',
            detail: `Expected HTTP 400 code=MISSING_CREDENTIALS, got HTTP ${response.status} code=${code ?? 'null'}`,
          }
    },
  },
  {
    name: 'login-real',
    requiredEnv: ['SMOKE_LOGIN_EMAIL', 'SMOKE_LOGIN_PASSWORD'],
    async run({ baseUrl, timeoutMs }) {
      // Opt-in only. This performs a REAL login (writes login-attempt state
      // on the target user) — never point this at prod. Use a dedicated
      // smoke-test account on a non-prod target.
      const { response, bodyText } = await timedFetch(
        `${baseUrl}/api/v1/auth/login`,
        {
          method: 'POST',
          headers: jsonHeaders(baseUrl),
          body: JSON.stringify({
            email: requireEnv('SMOKE_LOGIN_EMAIL'),
            password: requireEnv('SMOKE_LOGIN_PASSWORD'),
          }),
        },
        timeoutMs,
      )
      const code = parseCode(bodyText)
      return response.status === 200
        ? { status: 'passed', detail: `HTTP ${response.status}` }
        : {
            status: 'failed',
            detail: `Expected HTTP 200, got HTTP ${response.status} code=${code ?? 'null'}`,
          }
    },
  },
  {
    name: 'search-api',
    requiredEnv: [],
    async run({ baseUrl, timeoutMs }) {
      const { response, bodyText } = await timedFetch(
        `${baseUrl}/api/v1/search?tab=PROS`,
        { method: 'GET', headers: jsonHeaders(baseUrl) },
        timeoutMs,
      )
      let ok = false
      try {
        ok = (JSON.parse(bodyText) as { ok?: unknown }).ok === true
      } catch {
        ok = false
      }
      return response.status === 200 && ok
        ? { status: 'passed', detail: `HTTP ${response.status}` }
        : { status: 'failed', detail: `Expected HTTP 200 with ok:true, got HTTP ${response.status}` }
    },
  },
  {
    name: 'search-page',
    requiredEnv: [],
    async run({ baseUrl, timeoutMs }) {
      const { response } = await timedFetch(
        `${baseUrl}/search`,
        { method: 'GET', headers: htmlHeaders(baseUrl) },
        timeoutMs,
      )
      return response.status === 200
        ? { status: 'passed', detail: `HTTP ${response.status}` }
        : { status: 'failed', detail: `Expected HTTP 200, got ${response.status}` }
    },
  },
  {
    name: 'pro-profile-page',
    requiredEnv: ['SMOKE_PRO_ID'],
    async run({ baseUrl, timeoutMs }) {
      const { response } = await timedFetch(
        `${baseUrl}/professionals/${requireEnv('SMOKE_PRO_ID')}`,
        { method: 'GET', headers: htmlHeaders(baseUrl) },
        timeoutMs,
      )
      return response.status === 200
        ? { status: 'passed', detail: `HTTP ${response.status}` }
        : { status: 'failed', detail: `Expected HTTP 200, got ${response.status}` }
    },
  },
  {
    name: 'booking-page',
    requiredEnv: ['SMOKE_BOOKING_ID'],
    async run({ baseUrl, timeoutMs }) {
      const { response } = await timedFetch(
        `${baseUrl}/booking/${requireEnv('SMOKE_BOOKING_ID')}`,
        { method: 'GET', headers: htmlHeaders(baseUrl) },
        timeoutMs,
      )
      return response.status === 200
        ? { status: 'passed', detail: `HTTP ${response.status}` }
        : { status: 'failed', detail: `Expected HTTP 200, got ${response.status}` }
    },
  },
]

function parseCode(bodyText: string): string | null {
  if (!bodyText) return null
  try {
    const parsed = JSON.parse(bodyText) as { code?: unknown }
    return typeof parsed.code === 'string' ? parsed.code : null
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const baseUrl = requireEnv('SMOKE_BASE_URL').replace(/\/+$/, '')
  const timeoutMs = intEnv('SMOKE_REQUEST_TIMEOUT_MS', 10000)
  const ctx: CheckContext = { baseUrl, timeoutMs }

  const results: CheckResult[] = []

  for (const check of CHECKS) {
    const missing = missingEnv(check.requiredEnv)
    if (missing.length > 0) {
      results.push({
        name: check.name,
        status: 'skipped',
        durationMs: 0,
        detail: `Skipped — missing env: ${missing.join(', ')}`,
        missingEnv: missing,
      })
      continue
    }

    const startedAt = performance.now()
    try {
      const outcome = await check.run(ctx)
      results.push({
        name: check.name,
        durationMs: Math.round(performance.now() - startedAt),
        ...outcome,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      results.push({
        name: check.name,
        status: 'failed',
        durationMs: Math.round(performance.now() - startedAt),
        detail: `Threw: ${message}`,
      })
    }
  }

  for (const result of results) {
    const marker =
      result.status === 'passed' ? 'PASS' : result.status === 'failed' ? 'FAIL' : 'SKIP'
    console.log(`[${marker}] ${result.name} (${result.durationMs}ms) — ${result.detail}`)
  }

  const summary = {
    baseUrl,
    commit:
      process.env.VERCEL_GIT_COMMIT_SHA ??
      process.env.GITHUB_SHA ??
      process.env.COMMIT_SHA ??
      null,
    timestamp: new Date().toISOString(),
    totals: {
      passed: results.filter((r) => r.status === 'passed').length,
      failed: results.filter((r) => r.status === 'failed').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
    },
    results,
  }

  console.log(JSON.stringify(summary, null, 2))

  if (summary.totals.failed > 0) {
    process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(message)
  process.exit(1)
})

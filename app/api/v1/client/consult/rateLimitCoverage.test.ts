// app/api/v1/client/consult/rateLimitCoverage.test.ts
//
// Guard for the class of bug the 2026-08 consult audit found (F3): every
// mutating consult route existed with ZERO rate-limit call sites while the
// sibling client routes were covered, so each capture-quality retake and
// analysis attempt was an unmetered paid provider call.
//
// `tools/check-rate-limit-buckets-wired.mjs` pins the inverse direction (a
// registered bucket must be enforced somewhere); it deliberately does not pin
// that a surface NEEDS a bucket. This test pins that judgement for the consult
// class: every route file under app/api/v1/client/consult that exports a
// mutating handler must reference `enforceRateLimit`. A new consult route that
// ships without the limiter fails here, not in the next audit.

import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const ROUTE_DIR = path.join(__dirname)

const MUTATING_HANDLER = /export async function (POST|PUT|PATCH|DELETE)\b/

function collectRouteFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...collectRouteFiles(full))
    } else if (entry.name === 'route.ts') {
      out.push(full)
    }
  }
  return out
}

describe('consult route rate-limit coverage', () => {
  const routeFiles = collectRouteFiles(ROUTE_DIR)

  it('finds the consult route surface', () => {
    // If the tree moves, this test must move with it rather than silently
    // passing over an empty directory.
    expect(routeFiles.length).toBeGreaterThanOrEqual(19)
  })

  for (const file of routeFiles) {
    const relative = path.relative(ROUTE_DIR, file)
    const source = fs.readFileSync(file, 'utf8')
    if (!MUTATING_HANDLER.test(source)) continue

    it(`${relative} enforces a rate-limit bucket on its mutating handlers`, () => {
      expect(
        source.includes('enforceRateLimit'),
        `${relative} exports a mutating handler but never calls enforceRateLimit`,
      ).toBe(true)
    })
  }
})

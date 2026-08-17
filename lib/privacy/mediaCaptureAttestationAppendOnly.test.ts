// lib/privacy/mediaCaptureAttestationAppendOnly.test.ts
//
// MediaCaptureAttestation is append-only by design (see the model doc comment
// in prisma/schema.prisma): every row is written once by lib/media/attestCapture.ts
// and never updated. The only delete path is the account-deletion boundary
// (lib/privacy/deleteRules.ts). Nothing in the framework stops a future PR from
// adding `prisma.mediaCaptureAttestation.update(...)` somewhere, so this test
// greps the actual source tree for it — the guarantee only holds if this stays
// green.
import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { DELETE_RULES } from './deleteRules'

const REPO_ROOT = path.resolve(__dirname, '..', '..')

const EXCLUDED_DIRS = new Set([
  'node_modules',
  '.next',
  '.git',
  'coverage',
  'dist',
  'build',
])

// The only file allowed to mutate the table at all besides create — the
// account-deletion boundary's deleteMany.
const DELETE_RULES_FILE = path.join('lib', 'privacy', 'deleteRules.ts')

const MUTATION_PATTERN =
  /\.mediaCaptureAttestation\.(update|updateMany|upsert|delete|deleteMany)\s*\(/g

function walk(dir: string, out: string[]): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.githooks') continue
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue
      walk(fullPath, out)
      continue
    }

    if (/\.(ts|tsx|cts|mts)$/.test(entry.name)) {
      out.push(fullPath)
    }
  }

  return out
}

describe('MediaCaptureAttestation stays append-only', () => {
  it('has no update/upsert call anywhere in the source tree', () => {
    const files = walk(REPO_ROOT, [])
    const violations: Array<{ file: string; snippet: string }> = []

    for (const file of files) {
      const relative = path.relative(REPO_ROOT, file)
      // The delete-boundary's own deleteMany is the sanctioned exception.
      if (relative === DELETE_RULES_FILE) continue
      // Don't let this test's own pattern-in-a-comment trip itself.
      if (relative === path.join('lib', 'privacy', 'mediaCaptureAttestationAppendOnly.test.ts')) continue

      const content = fs.readFileSync(file, 'utf8')
      const matches = content.matchAll(MUTATION_PATTERN)

      for (const match of matches) {
        violations.push({ file: relative, snippet: match[0] })
      }
    }

    expect(
      violations,
      'MediaCaptureAttestation must stay append-only: no update/upsert, and ' +
        'delete only via the account-deletion boundary (lib/privacy/deleteRules.ts):\n' +
        violations.map((v) => `  - ${v.file}: ${v.snippet}`).join('\n'),
    ).toEqual([])
  })

  it('the delete-boundary rule actually deletes by professionalId, not just claims to', async () => {
    const rule = DELETE_RULES.find((r) => r.model === 'MediaCaptureAttestation')
    expect(rule).toBeDefined()
    expect(rule?.action).toBe('DELETE')

    const deleteMany = vi.fn().mockResolvedValue({ count: 3 })
    const count = vi.fn().mockResolvedValue(3)
    const db = { mediaCaptureAttestation: { deleteMany, count } } as never

    // A subject with no professional side (e.g. a client-only account) — the
    // rule must not apply, not run a where-less deleteMany.
    await rule!.apply(db, {
      userId: 'user_1',
      clientProfileId: 'client_1',
      professionalProfileId: null,
    })
    expect(deleteMany).not.toHaveBeenCalled()

    // A professional subject — must delete exactly by professionalId.
    await rule!.apply(db, {
      userId: 'user_1',
      clientProfileId: null,
      professionalProfileId: 'pro_1',
    })
    expect(deleteMany).toHaveBeenCalledWith({
      where: { professionalId: 'pro_1' },
    })
  })
})

// lib/aftercare/aftercarePublicTokenDeprecation.test.ts// lib/aftercare/aftercarePublicTokenDeprecation.test.ts
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const REPO_ROOT = process.cwd()

const ACTIVE_SOURCE_FILES = [
  'app/api/v1/pro/bookings/[id]/aftercare/route.ts',
  'app/api/v1/client/rebook/[token]/route.ts',
  'app/client/rebook/[token]/page.tsx',
  'app/client/(gated)/bookings/[id]/page.tsx',
  'lib/booking/writeBoundary.ts',
  'lib/clientActions/createAftercareAccessDelivery.ts',
  'lib/aftercare/aftercareAccessTokens.ts',
  'lib/aftercare/unclaimedAftercareAccess.ts',
] as const

function readRepoFile(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8')
}

describe('aftercare publicToken deprecation guard', () => {
  it('does not use aftercare.publicToken in active aftercare or rebook paths', () => {
    for (const relativePath of ACTIVE_SOURCE_FILES) {
      const source = readRepoFile(relativePath)

      expect(source, relativePath).not.toContain('aftercare.publicToken')
      expect(source, relativePath).not.toContain('publicToken: true')
      expect(source, relativePath).not.toMatch(
        /select:\s*{[\s\S]*publicToken:\s*true[\s\S]*}/,
      )
    }
  })

  it('does not build active client rebook links from legacy publicToken', () => {
    for (const relativePath of ACTIVE_SOURCE_FILES) {
      const source = readRepoFile(relativePath)

      expect(source, relativePath).not.toMatch(
        /\/client\/rebook\/\$\{[^}]*publicToken[^}]*\}/,
      )

      expect(source, relativePath).not.toMatch(
        /\/client\/rebook\/['"`]\s*\+\s*[^;\n]*publicToken/,
      )

      expect(source, relativePath).not.toMatch(
        /encodeURIComponent$begin:math:text$\[\^\)\]\*publicToken\[\^\)\]\*$end:math:text$/,
      )
    }
  })

  it('keeps active aftercare access backed by ClientActionToken', () => {
    const accessTokens = readRepoFile('lib/aftercare/aftercareAccessTokens.ts')
    const delivery = readRepoFile(
      'lib/clientActions/createAftercareAccessDelivery.ts',
    )
    const rebookRoute = readRepoFile('app/api/v1/client/rebook/[token]/route.ts')

    expect(accessTokens).toContain('ClientActionTokenKind.AFTERCARE_ACCESS')
    expect(accessTokens).toContain('resolveAftercareAccessTokenForRead')
    expect(accessTokens).toContain('resolveAftercareAccessTokenForMutation')

    expect(delivery).toContain('createAftercareAccessDelivery')
    expect(delivery).toContain("actionType: 'AFTERCARE_ACCESS'")

    expect(rebookRoute).toContain('resolveAftercareAccessTokenForRead')
    expect(rebookRoute).toContain('resolveAftercareAccessTokenForMutation')
  })

  it('allows publicToken to remain only as a legacy schema field for now', () => {
    const schema = readRepoFile('prisma/schema.prisma')

    expect(schema).toContain('model AftercareSummary')
    expect(schema).toContain('publicToken String? @unique')
  })
})
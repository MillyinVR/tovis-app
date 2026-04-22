// tests/auth/authVersionEnforcement.test.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')

const SCAN_ROOTS = [
  'app/api',
  'app/client',
  'app/pro',
  'app/admin',
  'app/messages',
] as const

const SCANNED_BASENAMES = new Set(['route.ts', 'page.tsx', 'layout.tsx'])

const DIRECT_SESSION_MARKERS = [
  'verifyToken(',
  'verifyMiddlewareToken(',
  "cookieStore.get('tovis_token')",
  'cookieStore.get("tovis_token")',
  "cookies().get('tovis_token')",
  'cookies().get("tovis_token")',
  "req.cookies.get('tovis_token')",
  'req.cookies.get("tovis_token")',
  "request.cookies.get('tovis_token')",
  'request.cookies.get("tovis_token")',
] as const

const AUTH_IMPORT_MARKERS = [
  "from '@/lib/currentUser'",
  'from "@/lib/currentUser"',
  "from '@/lib/auth/middlewareToken'",
  'from "@/lib/auth/middlewareToken"',
  "from '@/app/api/_utils/auth/requireUser'",
  'from "@/app/api/_utils/auth/requireUser"',
  "from '@/app/api/_utils/auth/requireClient'",
  'from "@/app/api/_utils/auth/requireClient"',
  "from '@/app/api/_utils/auth/requirePro'",
  'from "@/app/api/_utils/auth/requirePro"',
  "from '@/app/api/_utils/auth/requireAdmin'",
  'from "@/app/api/_utils/auth/requireAdmin"',
] as const

const SAFE_DB_BACKED_MARKERS = [
  'getCurrentUser(',
  'requireUser(',
  'requireClient(',
  'requirePro(',
  'requireAdmin(',
] as const

const ALLOWLIST = new Set<string>([
  'app/api/auth/login/route.ts',
  'app/api/auth/register/route.ts',
  'app/api/auth/logout/route.ts',
])

type Offender = {
  relPath: string
  reasons: string[]
}

function normalizeRel(relPath: string): string {
  return relPath.split(path.sep).join('/')
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return []

  const out: string[] = []

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)

    if (entry.isDirectory()) {
      out.push(...walk(fullPath))
      continue
    }

    out.push(fullPath)
  }

  return out
}

function getScannableFiles(): string[] {
  return SCAN_ROOTS.flatMap((root) =>
    walk(path.join(REPO_ROOT, root))
      .map((fullPath) => normalizeRel(path.relative(REPO_ROOT, fullPath)))
      .filter((relPath) => SCANNED_BASENAMES.has(path.basename(relPath)))
      .filter((relPath) => !relPath.includes('.test.')),
  ).sort()
}

function readFile(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8')
}

function hasAnyMarker(source: string, markers: readonly string[]): boolean {
  return markers.some((marker) => source.includes(marker))
}

function getMatchedMarkers(
  source: string,
  markers: readonly string[],
): string[] {
  return markers.filter((marker) => source.includes(marker))
}

function formatMarkerList(markers: readonly string[]): string {
  return markers.join(', ')
}

function failWithOffenders(
  title: string,
  offenders: readonly Offender[],
): never {
  const maxShown = 50
  const shown = offenders.slice(0, maxShown)

  const body = shown
    .map(
      (offender) =>
        `- ${offender.relPath}\n  ${offender.reasons.join('\n  ')}`,
    )
    .join('\n')

  const remaining =
    offenders.length > maxShown
      ? `\n...and ${offenders.length - maxShown} more offender(s).`
      : ''

  throw new Error(`${title}\n\n${body}${remaining}`)
}

function collectAuthValidationOffenders(): Offender[] {
  return getScannableFiles().flatMap((relPath) => {
    if (ALLOWLIST.has(relPath)) {
      return []
    }

    const source = readFile(relPath)
    const directSessionMarkers = getMatchedMarkers(source, DIRECT_SESSION_MARKERS)
    const authImportMarkers = getMatchedMarkers(source, AUTH_IMPORT_MARKERS)
    const safeDbBackedMarkers = getMatchedMarkers(source, SAFE_DB_BACKED_MARKERS)

    const touchesSession = directSessionMarkers.length > 0
    const importsAuth = authImportMarkers.length > 0

    if (!touchesSession && !importsAuth) {
      return []
    }

    if (safeDbBackedMarkers.length > 0) {
      return []
    }

    const reasons: string[] = []

    if (directSessionMarkers.length > 0) {
      reasons.push(
        `direct session markers without DB-backed validation: ${formatMarkerList(
          directSessionMarkers,
        )}`,
      )
    }

    if (authImportMarkers.length > 0) {
      reasons.push(
        `auth/session imports without DB-backed validation: ${formatMarkerList(
          authImportMarkers,
        )}`,
      )
    }

    reasons.push(
      `missing one of required DB-backed markers: ${formatMarkerList(
        SAFE_DB_BACKED_MARKERS,
      )}`,
    )

    return [{ relPath, reasons }]
  })
}

function collectRawTokenBypassOffenders(): Offender[] {
  return getScannableFiles().flatMap((relPath) => {
    if (ALLOWLIST.has(relPath)) {
      return []
    }

    const source = readFile(relPath)
    const directSessionMarkers = getMatchedMarkers(source, DIRECT_SESSION_MARKERS)
    const safeDbBackedMarkers = getMatchedMarkers(source, SAFE_DB_BACKED_MARKERS)

    if (directSessionMarkers.length === 0) {
      return []
    }

    if (safeDbBackedMarkers.length > 0) {
      return []
    }

    return [
      {
        relPath,
        reasons: [
          `raw token/JWT/session access without DB-backed validation: ${formatMarkerList(
            directSessionMarkers,
          )}`,
          `missing one of required DB-backed markers: ${formatMarkerList(
            SAFE_DB_BACKED_MARKERS,
          )}`,
        ],
      },
    ]
  })
}

describe('authVersion enforcement structure', () => {
  it('requires DB-backed current-user validation for app surfaces that touch auth/session code', () => {
    const offenders = collectAuthValidationOffenders()

    if (offenders.length > 0) {
      failWithOffenders(
        'Found app surfaces that touch auth/session code without DB-backed current-user validation.',
        offenders,
      )
    }

    expect(offenders).toHaveLength(0)
  })

  it('forbids raw token/JWT bypasses in authenticated app surfaces', () => {
    const offenders = collectRawTokenBypassOffenders()

    if (offenders.length > 0) {
      failWithOffenders(
        'Found authenticated app surfaces using raw token/JWT/session access without DB-backed validation.',
        offenders,
      )
    }

    expect(offenders).toHaveLength(0)
  })
})
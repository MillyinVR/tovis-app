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

describe('authVersion enforcement structure', () => {
  it('requires DB-backed current-user validation for app surfaces that touch auth/session code', () => {
    const offenders = getScannableFiles().filter((relPath) => {
      if (ALLOWLIST.has(relPath)) return false

      const source = readFile(relPath)
      const touchesSession = hasAnyMarker(source, DIRECT_SESSION_MARKERS)
      const importsAuth = hasAnyMarker(source, AUTH_IMPORT_MARKERS)

      if (!touchesSession && !importsAuth) {
        return false
      }

      return !hasAnyMarker(source, SAFE_DB_BACKED_MARKERS)
    })

    expect(offenders).toEqual([])
  })

  it('forbids raw token/JWT bypasses in authenticated app surfaces', () => {
    const offenders = getScannableFiles().filter((relPath) => {
      if (ALLOWLIST.has(relPath)) return false

      const source = readFile(relPath)

      return (
        hasAnyMarker(source, DIRECT_SESSION_MARKERS) &&
        !hasAnyMarker(source, SAFE_DB_BACKED_MARKERS)
      )
    })

    expect(offenders).toEqual([])
  })
})
// tools/check-no-bare-tint-token.mjs
//
// Tint-token opacity guard.
//
// Some brand colors are *tints*: values meant to be layered over a surface at a
// low alpha, never painted solid. `lib/brand/types.ts` marks them inline with
// `used with opacity`. Today that is `surfaceGlass`, whose value in
// `lib/brand/brands/tovis.ts` is byte-identical to `textPrimary` in BOTH modes
// (light `10 20 19`, dark `242 239 231`). So a bare `bg-surfaceGlass` — no
// `/alpha` — paints a label exactly its own background colour and the text
// disappears. Measured in a browser: `getComputedStyle(el).backgroundColor ===
// .color`. See PR #789 (R3) and the sweep that added this guard.
//
// Nothing else catches it. `check:no-hardcoded-brand-strings` and the raw-colour
// rule are about hex and stock Tailwind palettes; a *token* used at full opacity
// looks perfectly compliant, and typecheck/lint/tests are all green on it.
//
// The token list is DERIVED from `lib/brand/types.ts` rather than restated here,
// so a new tint token is covered the moment it is declared with that comment.
//
// Flagged:
//   • any Tailwind utility ending in `-<tintToken>` with no `/alpha`
//     (`bg-surfaceGlass`, `hover:bg-surfaceGlass`, `hover:file:bg-surfaceGlass`)
//   • `rgb(var(--surface-glass))` / `rgba(...)` in CSS with no ` / <alpha>`
//
// Allowed: `bg-surfaceGlass/10`, `border-surfaceGlass/12`,
// `rgb(var(--surface-glass) / 0.1)`, and the brand layer that defines the token.
//
// Usage:
//   node tools/check-no-bare-tint-token.mjs

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()

// The declaration that owns the token list. Its inline `used with opacity`
// comment is the marker; `→ --css-var` on the same line gives the CSS name.
const TOKEN_SOURCE = 'lib/brand/types.ts'

// The brand layer legitimately names these tokens at full value: the type
// declaration and the palettes that assign them. Everything else must supply an
// alpha. (`lib/brand/utils.ts`, which emits the CSS variables, needs no
// exemption — it writes `'--surface-glass': colors.surfaceGlass`, which neither
// pattern matches.)
const ALLOWED_PATH_PREFIXES = ['lib/brand/types.ts', 'lib/brand/brands/']

const SCAN_DIRS = ['app', 'lib']
const TARGET_EXTENSIONS = new Set(['.ts', '.tsx', '.css'])
const IGNORE_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage'])

function normalize(filePath) {
  return filePath.split(path.sep).join('/')
}

function isTestFile(relPath) {
  return (
    relPath.includes('.test.') ||
    relPath.includes('.spec.') ||
    relPath.includes('/__tests__/')
  )
}

/**
 * Read the tint tokens out of lib/brand/types.ts. A tint token is any field
 * whose declaration line carries the `used with opacity` marker; the `--css-var`
 * on that same line is captured so the CSS half of the check stays in sync too.
 */
function readTintTokens() {
  const source = path.join(ROOT, TOKEN_SOURCE)

  if (!fs.existsSync(source)) {
    throw new Error(
      `check-no-bare-tint-token: cannot find ${TOKEN_SOURCE} — the token list is ` +
        `derived from it. If the file moved, update TOKEN_SOURCE.`,
    )
  }

  const tokens = []

  for (const line of fs.readFileSync(source, 'utf8').split('\n')) {
    if (!/used with opacity/.test(line)) continue

    const name = line.match(/^\s*(\w+)\s*:/)?.[1]
    if (!name) continue

    tokens.push({ name, cssVar: line.match(/--[\w-]+/)?.[0] ?? null })
  }

  if (tokens.length === 0) {
    throw new Error(
      `check-no-bare-tint-token: no tokens marked "used with opacity" in ` +
        `${TOKEN_SOURCE}. Either the marker comment changed or the guard is now ` +
        `dead — fix one or the other rather than leaving it passing vacuously.`,
    )
  }

  return tokens
}

function listFiles(scanDir) {
  const abs = path.join(ROOT, scanDir)
  if (!fs.existsSync(abs)) return []

  return fs
    .readdirSync(abs, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath ?? entry.path, entry.name))
    .filter((file) => TARGET_EXTENSIONS.has(path.extname(file)))
    .filter(
      (file) =>
        !normalize(path.relative(ROOT, file))
          .split('/')
          .some((segment) => IGNORE_DIRS.has(segment)),
    )
}

function buildPatterns(token) {
  const patterns = [
    // A Tailwind utility ending in `-surfaceGlass` with nothing after it. The
    // leading `-` keeps identifiers (`mySurfaceGlass`) out, and the trailing
    // guard permits `/10` while rejecting a bare use at a class boundary.
    {
      regex: new RegExp(`(?<=[a-zA-Z])-${token.name}(?![\\w/-])`, 'g'),
      hint: `${token.name} is a tint token — give it an alpha (e.g. bg-${token.name}/10)`,
    },
  ]

  if (token.cssVar) {
    patterns.push({
      // `rgb(var(--surface-glass))` with no ` / <alpha>` before the closing paren.
      regex: new RegExp(
        `rgba?\\(\\s*var\\(\\s*${token.cssVar}\\s*\\)\\s*\\)`,
        'g',
      ),
      hint: `${token.cssVar} is a tint variable — use rgb(var(${token.cssVar}) / 0.1)`,
    })
  }

  return patterns
}

function findViolations(tokens) {
  const violations = []
  const patterns = tokens.flatMap(buildPatterns)

  for (const scanDir of SCAN_DIRS) {
    for (const file of listFiles(scanDir)) {
      const rel = normalize(path.relative(ROOT, file))

      if (isTestFile(rel)) continue
      if (ALLOWED_PATH_PREFIXES.some((prefix) => rel.startsWith(prefix))) continue

      const lines = fs.readFileSync(file, 'utf8').split('\n')

      lines.forEach((line, index) => {
        for (const { regex, hint } of patterns) {
          regex.lastIndex = 0
          if (!regex.test(line)) continue

          violations.push({
            file: rel,
            line: index + 1,
            snippet: line.trim(),
            hint,
          })
        }
      })
    }
  }

  return violations
}

function main() {
  let tokens

  try {
    tokens = readTintTokens()
  } catch (error) {
    // A guard that can no longer find its tokens must fail loudly. Passing
    // "because there was nothing to check" is how this bug class comes back.
    console.error(`\n${error.message}\n`)
    process.exit(1)
  }

  const violations = findViolations(tokens)

  if (violations.length > 0) {
    console.error('\ncheck-no-bare-tint-token: failed\n')
    console.error(
      'A tint token painted at full opacity is the same colour as the text on\n' +
        'top of it — the label renders invisible. Give the token an alpha.\n',
    )

    for (const violation of violations) {
      console.error(`${violation.file}:${violation.line}`)
      console.error(`  ${violation.snippet}`)
      console.error(`  → ${violation.hint}`)
    }

    console.error(`\nFound ${violations.length} bare tint-token uses.`)
    process.exit(1)
  }

  console.log(
    `check-no-bare-tint-token: passed (tint tokens always carry an alpha: ${tokens
      .map((t) => t.name)
      .join(', ')})`,
  )
}

main()

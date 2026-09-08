// Signup is private-beta only. This tripwire prevents a future account-creation
// route from bypassing the single-use invite transaction by writing User rows
// directly or forking the canonical registration seam.

import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const SEARCH_ROOTS = ['app', 'lib']
const CANONICAL_CREATOR = 'lib/auth/registration/createRegisteredAccount.ts'
const PUBLIC_SIGNUP_ROUTES = [
  'app/api/v1/auth/register/route.ts',
  'app/api/v1/auth/social/complete/route.ts',
]

function normalize(value) {
  return value.split(path.sep).join('/')
}

function walk(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      walk(full, files)
      continue
    }
    if (!entry.isFile() || !/\.(ts|tsx)$/.test(entry.name)) continue
    if (/\.(test|spec)\.(ts|tsx)$/.test(entry.name)) continue
    files.push(full)
  }
  return files
}

const files = SEARCH_ROOTS.flatMap((directory) =>
  walk(path.join(ROOT, directory)),
)

const directUserCreators = files
  .filter((file) => /\.(?:user)\.create\s*\(/.test(fs.readFileSync(file, 'utf8')))
  .map((file) => normalize(path.relative(ROOT, file)))

const violations = []

if (
  directUserCreators.length !== 1 ||
  directUserCreators[0] !== CANONICAL_CREATOR
) {
  violations.push(
    `User creation must exist only in ${CANONICAL_CREATOR}; found: ${directUserCreators.join(', ') || 'none'}`,
  )
}

const canonicalSource = fs.readFileSync(path.join(ROOT, CANONICAL_CREATOR), 'utf8')
if (!canonicalSource.includes('consumeSignupInvite({')) {
  violations.push(`${CANONICAL_CREATOR} no longer atomically consumes an invite.`)
}

for (const route of PUBLIC_SIGNUP_ROUTES) {
  const source = fs.readFileSync(path.join(ROOT, route), 'utf8')
  if (!source.includes('requireValidSignupInviteCode(')) {
    violations.push(`${route} no longer performs the invite preflight.`)
  }
  if (!source.includes('createRegisteredAccount({')) {
    violations.push(`${route} no longer uses the canonical account creator.`)
  }
}

if (violations.length > 0) {
  console.error('\nSignup invite guard failed:\n')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log('Signup invite guard passed.')

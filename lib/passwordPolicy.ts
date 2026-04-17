import breachedPasswords from './data/breached-passwords-10k.json'

export const PASSWORD_MIN_LEN = 10

const BREACHED_PASSWORDS = new Set(
  breachedPasswords.map((password) => password.trim().toLowerCase()).filter(Boolean),
)

function normalizePasswordForLookup(password: string): string {
  return password.trim().toLowerCase()
}

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LEN) {
    return `Password must be at least ${PASSWORD_MIN_LEN} characters.`
  }

  const normalizedPassword = normalizePasswordForLookup(password)

  if (BREACHED_PASSWORDS.has(normalizedPassword)) {
    return 'This password is too common. Choose something less predictable.'
  }

  return null
}
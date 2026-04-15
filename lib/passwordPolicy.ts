// lib/passwordPolicy.ts
export const PASSWORD_MIN_LEN = 10

const COMMON_BREACHED_PASSWORDS = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyuiop',
  'letmein',
  'welcome',
  'welcome123',
  'admin123',
  'passw0rd',
  'abc123456',
  '1111111111',
  '0000000000',
  'iloveyou',
  'princess',
  'dragon',
  'monkey',
  'baseball',
  'football',
  'shadow',
  'master',
  'superman',
  'asdfghjkl',
  'zaq12wsx',
  'qazwsx123',
  'trustno1',
  'sunshine',
  'whatever',
  'loginlogin',
  'freedom',
  'charlie123',
])

function normalizeForDenyList(password: string): string {
  return password.toLowerCase().replace(/\s+/g, '')
}

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LEN) {
    return `Password must be at least ${PASSWORD_MIN_LEN} characters.`
  }

  if (COMMON_BREACHED_PASSWORDS.has(normalizeForDenyList(password))) {
    return 'Please choose a less common password.'
  }

  return null
}
// lib/passwordPolicy.ts
export const PASSWORD_MIN_LEN = 8

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LEN) {
    return `Password must be at least ${PASSWORD_MIN_LEN} characters.`
  }

  // tiny “don’t be ridiculous” guardrail
  const lower = password.toLowerCase().trim()
  if (lower === 'password' || lower === 'password123' || lower === '12345678') {
    return 'Please choose a stronger password.'
  }

  return null
}

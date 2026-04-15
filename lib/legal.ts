// lib/legal.ts
export function getCurrentTosVersion(): string {
  const value = process.env.TOVIS_TOS_VERSION?.trim()

  if (!value) {
    throw new Error('Missing env var: TOVIS_TOS_VERSION')
  }

  return value
}
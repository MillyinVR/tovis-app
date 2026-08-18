// lib/notifications/optOut/smsOptOutKeywords.ts
//
// Twilio's canonical opt-out/opt-in/help keyword sets (case-insensitive,
// exact match after trim — a keyword sharing a word with a longer message,
// e.g. "stop by later", must NOT match). Matches the "Reply STOP to opt out
// and HELP for help" disclosure already shown at signup
// (lib/transactionalSmsPolicy.ts) — this is what makes that disclosure true.

export type SmsOptKeywordKind = 'STOP' | 'START' | 'HELP'

export type SmsOptKeywordMatch = {
  kind: SmsOptKeywordKind
  keyword: string
}

const STOP_KEYWORDS = new Set([
  'STOP',
  'STOPALL',
  'UNSUBSCRIBE',
  'CANCEL',
  'END',
  'QUIT',
])

const START_KEYWORDS = new Set(['START', 'YES', 'UNSTOP'])

const HELP_KEYWORDS = new Set(['HELP', 'INFO'])

export function classifySmsKeyword(
  body: string | null | undefined,
): SmsOptKeywordMatch | null {
  if (typeof body !== 'string') return null

  const keyword = body.trim().toUpperCase()
  if (!keyword) return null

  if (STOP_KEYWORDS.has(keyword)) return { kind: 'STOP', keyword }
  if (START_KEYWORDS.has(keyword)) return { kind: 'START', keyword }
  if (HELP_KEYWORDS.has(keyword)) return { kind: 'HELP', keyword }

  return null
}

/** Client-authored context, never a model observation or an instruction. */
export const CONSULT_INSPIRATION_CLIENT_TEXT_LIMIT = 600

export function validateInspirationClientText(raw: unknown):
  | { ok: true; text: string | null }
  | { ok: false } {
  if (raw == null) return { ok: true, text: null }
  if (typeof raw !== 'string' || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) return { ok: false }
  const text = raw.trim()
  if (text.length > CONSULT_INSPIRATION_CLIENT_TEXT_LIMIT) return { ok: false }
  return { ok: true, text: text || null }
}

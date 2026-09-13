// lib/consult/clientText.ts
//
// ONE rule for every sentence a CLIENT types into a consult — the inspiration
// cards, the intake questions, and the thread follow-ups all validate through
// here.
//
// Client-authored context, never a model observation and never an instruction.
// The limit and the control-character refusal shipped first for inspiration
// (P5c); intake and follow-ups joined them when Tori asked for the same escape
// hatch everywhere ("the client should have an option to fill in their own
// words", 2026-09-13). A second copy of "what counts as a typed answer" is a
// second place for the database guards to disagree with the application.

/** C0/C1 control codes except tab, newline and carriage return, plus DEL. */
const CONTROL_CHARACTERS =
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/

export const CONSULT_CLIENT_TEXT_LIMIT = 600

export function validateConsultClientText(raw: unknown):
  | { ok: true; text: string | null }
  | { ok: false } {
  if (raw == null) return { ok: true, text: null }
  if (typeof raw !== 'string' || CONTROL_CHARACTERS.test(raw)) return { ok: false }
  const text = raw.trim()
  if (text.length > CONSULT_CLIENT_TEXT_LIMIT) return { ok: false }
  return { ok: true, text: text || null }
}

/**
 * A stored `{key: "her sentence"}` map, narrowed.
 *
 * Used for BOTH stores: the intake revision's `textAnswers` sidecar and
 * `ConsultFollowUpRound.clientTextAnswers`. An entry that does not satisfy the
 * rule above is dropped rather than thrown on — the database guards already
 * proved the shape on the way in, so a bad entry is a row written by something
 * that bypassed them, and one of those must not take a consult down.
 */
export function readStoredConsultClientText(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const text: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const note = validateConsultClientText(value)
    if (note.ok && note.text) text[key] = note.text
  }
  return text
}

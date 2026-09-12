import type { ConsultThreadDTO } from '@/lib/dto/consult'

/**
 * The messages the client sees: everything up to and including the one that is
 * waiting for her, and nothing after it.
 *
 * Tori's call (2026-09-11): the consult reads as a CHAT — one thing at a time,
 * the answered step scrolls up into history, the next one arrives underneath.
 * This reverses #1149 (2026-09-10), which put every later step back on screen
 * dimmed; that version read as a form with the fields greyed out.
 *
 * `nextOpenMessageId` is the SERVER's answer to "which step is next" — the first
 * OPEN message in thread order — so the slice is taken from it rather than from
 * a client-side re-derivation of the state machine. A thread with nothing open
 * (finished, stopped, or waiting on the pro) shows all of its history.
 *
 * 🔴 Several messages can be OPEN at once server-side (the inspiration review
 * and the photo pack are concurrent). That stays true on the wire; here she is
 * simply walked through them in order. A BLOCKED message that sits BEFORE the
 * open one (a photo she skipped, once the plan exists) is still rendered and
 * still tappable — hiding it would take a retake away.
 */
export function visibleConsultThreadMessages(
  thread: Pick<ConsultThreadDTO, 'messages' | 'nextOpenMessageId'>,
): ConsultThreadDTO['messages'] {
  const current = thread.messages.findIndex(
    (message) => message.id === thread.nextOpenMessageId,
  )
  return current < 0 ? thread.messages : thread.messages.slice(0, current + 1)
}

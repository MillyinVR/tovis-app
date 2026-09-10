import type { ConsultThreadDTO } from '@/lib/dto/consult'

/** Keep conversation history and the current turn; do not preview later tasks. */
export function visibleConsultThreadMessages(thread: Pick<ConsultThreadDTO, 'messages' | 'nextOpenMessageId'>) {
  const current = thread.messages.findIndex(message => message.id === thread.nextOpenMessageId)
  return current < 0 ? thread.messages : thread.messages.slice(0, current + 1)
}

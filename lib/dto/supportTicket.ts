// lib/dto/supportTicket.ts
//
// JSON-safe wire DTO for a freshly filed SupportTicket. Deliberately does NOT
// echo the `message` back — the caller just submitted it and holds it already;
// there's nothing for a client to do with it, and a support message is exactly
// the kind of free text that shouldn't reappear in client logs.
//
// There is no ticket READ surface yet (native files a ticket and is done; the
// queue lives at `/admin/support`), so this is a create-response shape only.
import type { CreatedSupportTicket } from '@/lib/support/createSupportTicket'

export type SupportTicketDTO = {
  id: string
  subject: string
  /** `OPEN` | `IN_PROGRESS` | `CLOSED` — always `OPEN` on create. */
  status: string
  /** ISO-8601 */
  createdAt: string
}

export function serializeSupportTicket(row: CreatedSupportTicket): SupportTicketDTO {
  return {
    id: row.id,
    subject: row.subject,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }
}

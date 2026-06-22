// lib/clients/clientNoteKinds.ts
//
// Pure helpers for the typed client-note discriminator (PR3). Kept Prisma-light
// so the kind→visibility policy and the chart's grouping are unit-testable in
// isolation. The kind→visibility mapping is the security-relevant bit: a
// DO_NOT_REBOOK entry is ALWAYS author-scoped (PRIVATE_TO_AUTHOR), never shared.

import { ClientNoteKind, ClientNoteVisibility } from '@prisma/client'

export const CLIENT_NOTE_KIND_LABELS: Record<ClientNoteKind, string> = {
  GENERAL: 'General',
  CONSULTATION: 'Consultation',
  COMMUNICATION_STYLE: 'Communication style',
  DO_NOT_REBOOK: 'Do not rebook',
}

/**
 * Kinds offered in the general "add note" form, in display order. DO_NOT_REBOOK
 * is deliberately excluded — it has its own dedicated form (factual-copy helper
 * text + author-only visibility).
 */
export const AUTHORABLE_NOTE_KINDS: readonly ClientNoteKind[] = [
  ClientNoteKind.GENERAL,
  ClientNoteKind.CONSULTATION,
  ClientNoteKind.COMMUNICATION_STYLE,
]

/** Order the grouped (shared) note sections render in on the chart. */
const GROUPED_NOTE_KINDS: readonly ClientNoteKind[] = AUTHORABLE_NOTE_KINDS

export function isClientNoteKind(value: unknown): value is ClientNoteKind {
  return (
    typeof value === 'string' &&
    Object.prototype.hasOwnProperty.call(CLIENT_NOTE_KIND_LABELS, value)
  )
}

/**
 * Validate a kind coming from the general note form. Anything unknown — or an
 * attempt to author a DO_NOT_REBOOK note through the general path — collapses to
 * GENERAL. DO_NOT_REBOOK is reachable only via its dedicated endpoint.
 */
export function normalizeAuthorableNoteKind(raw: unknown): ClientNoteKind {
  const trimmed = typeof raw === 'string' ? raw.trim().toUpperCase() : ''
  return AUTHORABLE_NOTE_KINDS.includes(trimmed as ClientNoteKind)
    ? (trimmed as ClientNoteKind)
    : ClientNoteKind.GENERAL
}

/** The ONLY place kind→visibility is decided. */
export function visibilityForNoteKind(
  kind: ClientNoteKind,
): ClientNoteVisibility {
  return kind === ClientNoteKind.DO_NOT_REBOOK
    ? ClientNoteVisibility.PRIVATE_TO_AUTHOR
    : ClientNoteVisibility.PROFESSIONALS_ONLY
}

export type NoteKindGroup<T> = {
  kind: ClientNoteKind
  label: string
  notes: T[]
}

/**
 * Split the authoring pro's own notes into the grouped "professional memory"
 * sections (General / Consultation / Communication style) plus the separate
 * DO_NOT_REBOOK entries the caller surfaces on its own. Empty groups are dropped.
 */
export function partitionNotesByKind<T extends { kind: ClientNoteKind }>(
  notes: T[],
): { groups: NoteKindGroup<T>[]; doNotRebook: T[] } {
  const doNotRebook = notes.filter(
    (note) => note.kind === ClientNoteKind.DO_NOT_REBOOK,
  )

  const groups = GROUPED_NOTE_KINDS.map((kind) => ({
    kind,
    label: CLIENT_NOTE_KIND_LABELS[kind],
    notes: notes.filter((note) => note.kind === kind),
  })).filter((group) => group.notes.length > 0)

  return { groups, doNotRebook }
}

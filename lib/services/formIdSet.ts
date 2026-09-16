// lib/services/formIdSet.ts
//
// One way to read "a set of ids" out of a form.
//
// Two admin link surfaces need the identical rule — a service's additional
// categories (`categoryLinks.ts`) and a viral name's base services
// (`viralBaseServiceLinks.ts`) — and the rule has one part that is easy to get
// wrong in a second copy:
//
// 🔴 **Absent is not empty.** A field that is not in the form means "leave this
// alone"; a field present but blank means "make it empty". A replace-set write
// that reads absent as empty WIPES the links every time a form that does not
// know about them is saved (memory: a replace write that does not echo a field
// wipes it). That distinction is the reason this is a shared function rather
// than four lines inlined twice.

/**
 * The ids named by `field`, or `null` when the field is absent entirely.
 *
 * Accepts repeated fields and comma-joined values, trimmed and de-duplicated,
 * so a checkbox list and a single hidden input both work.
 */
export function parseFormIdSet(form: FormData, field: string): string[] | null {
  if (!form.has(field)) return null

  const ids = new Set<string>()

  for (const raw of form.getAll(field)) {
    if (typeof raw !== 'string') continue
    for (const part of raw.split(',')) {
      const id = part.trim()
      if (id) ids.add(id)
    }
  }

  return [...ids]
}

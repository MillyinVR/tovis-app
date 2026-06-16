# Waitlist / Last-Minute UI — design handoff

Brief for the design pass that will restyle the surfaces touched by the
"last-minute openings + waitlist operational" work (branch
`feature/last-minute-waitlist-operational`). Read the **Guardrails** first — they
prevent breaking the data wiring — then work the files in the listed order.

---

## What just became live (so you know what to style)

1. **Pro Calendar → "Waitlist" stat tile + management list.** Previously dark
   scaffolding (always empty). Now backed by real data. This is the only genuinely
   NEW visual element.
2. **Messages → "Waitlists" filter tab + thread.** The tab existed but never had
   content; now a client joining a waitlist creates a real thread that shows here.
3. **Client waitlist strip** on the gated client home (already live; included for
   visual consistency).

The last-minute *notification* itself is delivered as SMS/email/in-app — there is no
React page for it, so it's out of scope for this pass.

---

## Guardrails (must-read before editing)

- **Use brand tokens, never hardcoded colors.** Colors come from CSS vars
  (`--color-*`, e.g. `--color-acid`) defined in `lib/brand/brand.css` +
  `lib/brand/types.ts` + `lib/brand/utils.ts`. There is a CI guard
  (`npm run check:no-hardcoded-brand-strings`) that FAILS on hardcoded brand
  strings. If the waitlist color needs to change, change the **token**, not an inline hex.
- **This is Tailwind v4** with an `@config` bridge in `globals.css`. JS-config edits
  need a dev-server restart to take effect.
- **Copy lives in brand files, not components.** Waitlist labels/empty-states are in
  `lib/brand/defaultProCalendarCopy.ts` (keys: `waitlist`, `waitlistSub`,
  `waitlistTitle`, `emptyWaitlist`). Change copy there, not by hardcoding in JSX.
- **Do NOT change data contracts / prop shapes / logic.** Style only. Specifically,
  leave these exactly as-is (they are contract, not presentation):
  - The synthesized event shape: `kind: 'BOOKING'`, `status: 'WAITLIST'`,
    `id: 'waitlist:<entryId>'`. The `status` literal and `id` prefix are how the
    parser + status styling find these events.
  - The tone names `'waitlist'` (status styling) and `'acid'` (the stat tile tone).
    Restyle what those tones LOOK like via brand tokens — don't rename them.
  - `showWaitlist={cal.management.waitlistToday.length > 0}` on the three calendar
    shells — keep this; it hides the tile when empty.
  - Prop names on `CalendarStatsPanel` / `ManagementModal`, the inbox filter key
    `'waitlists'`, and `contextType: WAITLIST`.
- After editing, run: `npm run typecheck`, `npm run test`, and
  `npm run check:static-guards`. Pay attention to the calendar + messages route
  tests and the no-hardcoded-brand-strings guard.

---

## Files in order (work top-to-bottom)

### A. Pro Calendar waitlist tile — the new visual (highest priority)
1. **`app/pro/calendar/_utils/statusStyles.ts`** — the styling brain. Defines the
   `'waitlist'` tone, `isWaitlist`, and the "Waitlist" label. This is where the
   WAITLIST status's color/treatment is decided. Start here so every downstream
   surface inherits a consistent waitlist look.
2. **`app/pro/calendar/_components/CalendarStatsPanel.tsx`** — the stat tile itself
   (currently `tone: 'acid'`). Style the tile's look; keep the `showWaitlist` gate
   and `managementKey: 'waitlistToday'`.
3. **`app/pro/calendar/_components/ManagementModal.tsx`** — the list that opens when
   you tap the tile: each waitlister row (name, service, status badge) + the empty
   state. Copy comes from `defaultProCalendarCopy` (`waitlistTitle`, `emptyWaitlist`).
4. **`app/pro/calendar/_components/_grid/EventCard.tsx`** — only if you want to touch
   how a `status === 'WAITLIST'` badge looks on a card. (Waitlist events render in the
   modal, not the grid, so this is optional/consistency-only.)
5. **`lib/brand/defaultProCalendarCopy.ts`** — adjust waitlist copy strings here if
   wording should change (do NOT hardcode in the components above).
6. **Calendar shells** (`CalendarDesktopShell.tsx`, `CalendarTabletShell.tsx`,
   `CalendarMobileShell.tsx`) — only if the tile's PLACEMENT in each responsive layout
   needs adjusting. The `showWaitlist` prop is already wired; don't remove it.

### B. Messages — waitlist tab + thread
7. **`app/messages/page.tsx`** — the inbox list + the "Waitlists" filter tab. Style the
   row/tab; keep the filter key `'waitlists'`.
8. **`app/messages/thread/[id]/page.tsx`** — the thread detail header that shows the
   waitlist status + preference summary. Style the header; keep the data fields.

### C. Client side (consistency)
9. **`app/client/(gated)/_components/ClientWaitlistStrip.tsx`** — the client's
   "you're on the waitlist" strip on the gated home. Restyle to match new branding.

### D. Brand tokens (only if the waitlist/acid color itself must change)
10. `lib/brand/brand.css`, `lib/brand/types.ts`, `lib/brand/utils.ts` — the token
    definitions behind `--color-acid` and friends. Change the color HERE so it
    propagates everywhere, instead of overriding per-component.

---

## Reference
- Brand bundle / prompts: `docs/design/brand-handoff/` (gitignored local bundle) and
  `docs/design/redesign-prompts.md`.
- The backend/API behind these screens (no styling here, do not edit): `vercel.json`,
  `lib/booking/writeBoundary.ts`, `app/api/waitlist/route.ts`,
  `app/api/pro/calendar/route.ts`.

# TOVIS — Group Bookings & Events

**Backlog section:** unassigned — needs a §N assigned by Tori before this is cross-referenced anywhere
**Source:** consolidated from design sessions (original concept ~2025, prototype rebuild April 2026, audit July 2026)
**Prototype:** `tovis-group-booking-v2.jsx` (interactive, all five tabs built)

> This is a spec, not a build order. Nothing here has been implemented. The only
> piece that touches shipped code is the messaging schema note in §10 — that one
> needs verification, not construction.

---

## 1. Premise

Group bookings for beauty events: bridal parties, prom groups, quinceañeras,
festival squads, girls' trips.

Founding insight: **pros lose money on group bookings because of the "chaos tax."**
Coordination — chasing confirmations, relaying inspiration photos, rescheduling
when one person is late — all lands on the pro and none of it is billable.

Design principle: **take coordination off the pro's plate entirely and hand it to
the group.** The pro's only day-of controls are Start, Complete, and Running Late.

---

## 2. Roles

| Role | Capability |
|---|---|
| **Group Manager** | One client. Creates the group, sets up the booking, pays or coordinates the deposit. |
| **Group Member** | Confirms their own slot, posts to group chat, pays their own service, can cover others. |
| **Pro** | Sees the per-client Vision Board, controls the day-of timeline. Does not coordinate. |

**Open:** can a pro initiate a group booking and invite clients, or is it
client-organizer only? Raised during the v2 rebuild, never locked.

---

## 3. Feature Surface — five tabs

### 3.1 Hub
- Member list with Manager badge
- Counts: confirmed / paid / vision board items
- Pending-member nudge
- Vision board preview — what's already been sent to the pro

### 3.2 Day-Of
- Live timeline with an "In Chair Now" banner
- Pro controls: **Start** / **Complete** / **Running Late**
- Running Late opens a modal asking *which type* of late (see §4)
- Swap-offer button appears on delayed slots
- Timeline is visible to every member in real time

### 3.3 Group Chat
- Text and image posts in one feed
- Image posts have likes and comments
- Single **"+ Add to Vision Board"** button per image → marks it sent to the pro
  with a confirmation pill
- No copy/paste, no side DMs to the pro — one tap

### 3.4 Payment
- Group deposit status at top
- Per-member payment card with **Pay** and **Cover** buttons
- Cover modal: multi-select members, shows running total before confirm

### 3.5 Alerts
- Notification feed, unread dot on the tab, unread count on the header bell
- Swap offers have inline Accept / Decline

---

## 4. Two distinct "late" types

These are **not** the same event and must not share a code path.

| Type | Cause | Resolution |
|---|---|---|
| **Pro running late** | Current service overran | Members scheduled after are notified; open window offered for swap |
| **Client running late** | Member stuck in traffic | Different notification language; their slot may be offered to someone behind them |

Different copy, different resolution flow, different notification targets.

---

## 5. Slot swap logic

**Flagged as the hardest piece in the whole feature.**

- A delayed or vacated slot is offered to members scheduled after it
- Swap requires **two-party confirmation** — both members must accept before the
  timeline commits
- Needs an explicit **pending state**; the timeline must not mutate on the first accept
- Confirmation modal shows both names and states that it updates everyone's view
- **Claim window:** if nobody claims an opened slot in ~10 minutes, it either holds
  or auto-notifies the next person — so the pro doesn't eat a gap

Everything outside swap was assessed as straightforward Supabase Realtime work.

---

## 6. Payments

- **Individual payment** at checkout per member; prepay if the pro requires it
- **"Cover someone else"** — surfaced as an opt-in toggle at the member's own
  checkout ("Add someone to this payment?") → member picker → running total.
  Visible, not buried.
- **Group deposit** at booking creation — Manager pays a deposit to hold all slots;
  members either reimburse the Manager in-app or pay their own deposit separately.
  Protects the pro from a six-person booking where three ghost. Ties into existing
  waitlist logic.

---

## 7. Vision Board

- Client-side: group approves a look in chat → one tap sends it to the pro
- Pro-side: approved looks land in a **per-client Vision Board**, so before the day
  the pro can see Sarah wants loose waves with glitter, Emma wants a cut crease,
  etc. — all in one place, no digging through group chat
- Pings the pro as "[Name] is adding [style] to their vision board"

**Open:** does the inspiration board pull from the TOVIS Looks feed, camera-roll
uploads, or both? Raised during the v2 rebuild, never locked.

---

## 8. Notifications

The day-of experience lives or dies on notification timing. It has to feel like a
live update system, not an afterthought.

Push required for:
- Service started
- Running late (both types)
- Swap offered
- Swap confirmed
- Your slot is next (15-minute warning)
- Your service complete

---

## 9. Data models

**GroupBooking** — pro, event name, date, location, deposit amount + status, manager (a client member)

**GroupMember** — belongs to GroupBooking; links to User; service, slot order, payment status, confirmation status

**GroupMessage** — belongs to GroupBooking; type (text | image), author, optional vision-board flag, likes, comments sub-collection

**GroupTimelineSlot** — belongs to GroupBooking; linked to GroupMember; status, start time, duration, delay

**GroupNotification** — belongs to GroupBooking; type (started | late | swap_offer | swap_confirmed | slot_warning), targets specific member IDs

---

## 10. Schema dependencies (touches v1)

The messaging schema was supposed to be built v1-ready for this:

- `conversation_type` enum on messages: `direct` | `group` | `event`
- Built on Supabase Realtime (postgres changes), not polling

Only `direct` was in v1 scope. The enum was meant to land anyway so group/event
becomes a new query rather than a re-architecture.

**Action — audit only:** verify the `conversation_type` enum actually exists in the
current messages schema. Messaging is known to be in rough shape, so do not assume
this landed. Do not add it as part of this ticket; report findings first.

---

## 11. Unresolved — must be answered before any build

1. **Cancellation.** If one member drops out of a six-person booking, what happens to:
   - the rest of the timeline (does everyone shift up, or do slots hold?)
   - the group deposit
   - the pro's blocked time
   This was never resolved and was explicitly flagged as the question to lead with,
   so the feature doesn't get built for the happy path only.
2. **Who can create a group** — client organizer only, or pro-initiated too?
3. **Inspiration source** — Looks feed, uploads, or both?
4. **Day-of timeline visibility** — pro-facing, client-facing, or both (and who controls it)?

---

## 12. Prior art

Original concept (pre-rebuild) had five screens: Group Planning Hub, Inspiration
board with a *Share with Group* / *Share with Provider* split, Live Service
Timeline, and a Coordination Dashboard with auto-pilot reminder intensity
(Gentle / Standard / Extra Coverage) plus Smart Timeline milestones
(2 months out → 1 month → 1 week) and a Send Group Reminder action.

The **auto-pilot reminder intensity** and **smart timeline milestones** did *not*
carry into the v2 prototype. Worth a decision on whether they come back.

The v2 rebuild moved the whole thing onto the Finance tab's dark quiet-luxury
aesthetic while keeping the social layer.

---

## 13. Gaps identified (July 2026 review)

Raised during a spec review; none of these are resolved. Ordered by cost-if-missed.

### 13.1 Multi-pro groups — structural
The entire spec above assumes **one pro**. `GroupBooking` has a singular `pro`
field. A real bridal party is hair *and* makeup — often two or three pros in
parallel or staggered chairs.

If single-pro ships first and a second pro is needed later, the timeline,
notification targeting, and deposit split all get re-architected.

**Recommendation:** model pros as a join table from the start, even if the UI only
exposes one. Same reasoning as the `conversation_type` enum in §10.

### 13.2 Pro-side acceptance — unspecced
There is no accept / decline / counter-propose flow. A six-person group is a
four-hour block of a Saturday, and the current spec assumes the pro simply has it.

Missing:
- Accept / decline / counter-propose on the group request
- Partial accept ("I can take 4 of 6")
- Deposit-before-calendar-hold gate
- What the group sees while the request is pending

Most likely single reason a pro would resent this feature.

### 13.3 Cancellation should inherit from NO_SHOW_PROTECTION
`NO_SHOW_PROTECTION` already exists behind a flag, held pending a support-readiness
decision. Group cancellation (§11.1) is the same problem at 6x scale.

**Recommendation:** do not design a separate group cancellation policy. Resolve the
no-show flag first and extend it, so there's one policy surface, not two.

### 13.4 Remix booking-protection fee collision
The Remix Your Look monetization applies a 5% booking protection fee on a client's
first booking with a new-discovery pro. A group is potentially **six simultaneous
first-bookings with the same pro**.

Undecided:
- Does the 5% apply per member, or once per group?
- Does the Manager absorb it, or is it split?
- Do the existing waivers (returning client, direct-link arrival, pro-added client)
  evaluate per member or per group?

Needs a decision before launch or it becomes a day-one support load.

### 13.5 Non-app members — reuse ProClientInvite
A significant share of any group won't have TOVIS accounts. `ProClientInvite`
(pre-filled info, quick-signup token, PENDING / ACCEPTED / EXPIRED) was already
specced for the pro-to-pro workstream and is the right primitive here.

**Recommendation:** reuse it. Do not introduce a parallel `GroupInvite` model.

### 13.6 Mobile / on-location service
Groups skew heavily toward "come to the venue." The missing mobile-service-address
UI is already a hard blocker on the main backlog — this feature makes it load-bearing
rather than incidental.

### 13.7 Timeline cascade — absorbing delay, not just reporting it
Every slot depends on the one before it. The spec covers *reporting* a delay but not
*absorbing* one. There is no per-slot buffer, no configurable padding, and no
auto-reflow of downstream slots.

A 20-minute overrun at 10:00 AM silently breaks the 1:00 PM slot with no warning
until it's too late to swap.

### 13.8 Vision Board vs. the AI consultation layer
Both solve "structured intake so the pro walks in knowing what the client wants."
If the AI consultation layer ships first, Vision Board should **feed** it rather
than sit beside it — otherwise pros have two separate inspiration inboxes to check
before every appointment.

---

## 14. July 2026 review — audit findings & suggestions (Claude session with Tori, 2026-07-18)

> Appended when this spec moved into `docs/design/`. Original text above is
> untouched. The AI-consult counterpart doc is
> [`ai-consult.md`](./ai-consult.md) — its group-event hook and §13.8 here
> describe the same integration (Vision Board feeds the consult brief; one
> pro-facing inbox per client).

### 14.1 §10 audit result — the `conversation_type` enum did NOT land

Verified against `prisma/schema.prisma` 2026-07-18. There is no
`conversation_type` (direct | group | event) enum. What exists is
`MessageThreadContextType` (BOOKING / SERVICE / OFFERING / PRO_PROFILE /
WAITLIST) — a *what's-this-about* enum, not a *how-many-people* enum — and
`MessageThread` is hard-wired one-client-one-pro (`clientId` +
`professionalId` scalars; uniqueness on that pair + context). Silver lining: a
`MessageThreadParticipant` join table already exists — the right seed for
multi-person threads. **Group chat is schema work on the thread's spine, not
"a new query."** Budget for it.

### 14.2 Structural recommendation — group slots are real Bookings

The §9 models describe a parallel booking system (`GroupMember` with its own
payment status, `GroupTimelineSlot` with its own lifecycle). If a member's slot
is not an actual `Booking` row, groups need re-implementations of payments,
reminders, no-show, aftercare, reviews, charts, and idempotency — and every
future feature forks into "normal vs. group." Instead: **`GroupBooking` is a
coordination shell; each member's service is a real `Booking` linked to it**;
the day-of timeline is a view over those bookings plus slot metadata. This
auto-resolves §13.4 (remix fee evaluates per Booking per member, as it already
does) and makes §13.3 natural (each slot *is* a booking, so NO_SHOW_PROTECTION
extends rather than duplicates).

### 14.3 De-risk §5 — cut two-party swaps from v1

Ship claim-based reflow only: a slot opens (late/dropped) → members behind it
get a claim offer → first accept wins, ~10-minute window, then release. That is
single-party, no pending-both-sides state machine, and mirrors the existing
priority-offer claim-window machinery. True A↔B trades are v2 if real groups
demand them.

### 14.4 Money — never client→client

"Members reimburse the Manager in-app" (§6) is P2P money movement — money-
transmission territory. Keep every flow client→pro: each member pays their own
deposit share at join (slots confirm as shares land); "Cover" stays as-is
(covering someone's service is still a client→pro charge); a Manager who fronts
the deposit gets reimbursed off-platform.

### 14.5 Group-visibility of services and prices — default private

Members see times and names ("Sarah — in chair"), their own full details, and
aggregate payment progress ("4 of 6 paid"). Service labels and amounts are
member-opt-in — some services are personal and prices differ. Decide now;
awkward to retrofit.

### 14.6 Accounts — required, but one tap (explicit decision)

The spec implies every member has an account (§9 GroupMember→User; §13.5
quick-signup invite) but never states it. Recommendation: **account required**,
via the `ProClientInvite` one-tap token — payments/chat/notifications need
identity, and converting the group into clients is half the business case. A
middle path exists if RSVP friction shows up: `ClientActionToken`-style magic
links (the public consultation/rebook pages' machinery) could give guests
view-timeline + confirm-own-slot with no account, reserving accounts for
chat/Vision Board/payment. v1: account-required; magic-link guest view is the
v2 escape hatch.

### 14.7 Post-event flow — the spec ends at "Complete"

The day after is where value compounds: group recap (pro's session photos,
consent-gated), per-member aftercare, review prompts to every member, rebook
suggestions — and §13.5's quick-signup members convert into real clients with a
completed booking in history. Every group event is an acquisition event; spec
it.

### 14.8 Notifications — reuse, including quiet hours

Day-of pushes (started / late / swap / you're-next) are transactional → they
must join the quiet-hours **bypass** list (precedent: consultation proposal,
aftercare). Pre-event reminders should NOT resurrect §12's auto-pilot intensity
system — link the GroupBooking to a dated Board and the existing 30/14/7/3
event-countdown machinery (and the consult's event mode) ride along free.

### 14.9 Timeline cascade concretes (extends §13.7)

Per-slot buffer from the pro's settings at acceptance time; delay reflow
*proposes* a batched shift (one notification, members ack) rather than silently
mutating; "running late" carries a real ETA computed from remaining durations,
not a binary flag.

### 14.10 Small but real

Calendar files (.ics / native add) at slot confirmation. For §13.1: agree with
the join table — and design the Day-Of screen as parallel *lanes* from day one
even if v1 renders a single lane.

### 14.11 Votes on §11 (recommendations, Tori decides)

1. **Cancellation:** slots hold by default (no auto-shift); dropped member
   forfeits their deposit share per the pro's policy; freed slot → claim window
   → pro's openings/waitlist machinery. Unify with NO_SHOW_PROTECTION (§13.3).
2. **Who creates:** client-organizer only in v1 (pro-initiated drags §13.2
   forward).
3. **Inspiration source:** both — through the consult / Vision Board pipeline
   (§13.8).
4. **Timeline visibility:** everyone sees the timeline; service detail is
   per-member-private by default (§14.5).

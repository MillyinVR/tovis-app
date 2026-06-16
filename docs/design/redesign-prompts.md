# Tovis redesign — Claude Design prompt pack

Ready-to-paste prompts for producing redesign mockups of every user-facing page in
the Tovis app, using **Claude Design** (claude.ai/design).

## How to use this

Claude Design keeps context across files *within one project*. Work in this order
so the style carries forward and you don't redesign 76 pages individually:

1. **Foundation** — paste the foundation prompt below as the first file. This locks
   the palette, type, and component language to the real Tovis brand. Confirm the look.
2. **Archetypes** — paste each archetype prompt (sections 1–9). These are ~10 screens
   that cover all 76 pages. Grounded in the real fields/actions/copy from the codebase.
3. **Variants** — for the remaining pages, use a one-liner: *"Same layout as the
   [archetype] screen, but for [page] — fields: X, Y, Z."* See the variant map at the end.

All copy, field labels, status vocab, and states below are taken from the actual code,
so the mockups read like the real product instead of generic placeholders.

---

## 0. Foundation — design system (paste first)

> **Build a design-system reference sheet for "Tovis" — a premium self-care / beauty-pro
> booking app. Tagline: "A New Age of Self Care." This sheet anchors the visual language
> for every screen that follows.**
>
> **Mode:** Dark is primary. Warm espresso, editorial, tactile — not a generic SaaS dashboard.
>
> **Palette (dark mode, RGB):** bg primary `10 9 7`, bg secondary `20 17 14`, surface `30 26 21`.
> Text primary `244 239 231`, secondary `205 198 187`, muted `122 117 105`.
> Accent (terracotta) `224 90 40`, hover `255 106 54`.
> Status: success/fern `98 168 122`, danger/ember `255 61 78`, warn/amber `240 168 48`,
> acid-lime micro-accent `212 255 58`.
> Light mode is a warm parchment inversion (bg `244 239 231`, text `10 9 7`, same terracotta accent).
>
> **Type:** Display = Fraunces (serif, tight -0.03em, used for hero/page titles, often italic).
> Body/UI = Inter Tight. Mono = JetBrains Mono for labels/metadata.
> Section labels are 10px, weight 900, uppercase, letter-spacing 0.16em, often prefixed with ◆.
>
> **Surfaces:** Cards 14px radius, solid `bg-secondary` with a 1px `text/8%` border.
> Floating elements (modals, drawers, bottom bars) use warm frosted glass, 20px blur.
> App-icon radius 28px, pills 999px.
>
> **Atmosphere:** Body has a subtle terracotta radial glow top-left + parchment gradient
> (opacity ~0.05 — atmospheric, not orange). Focus rings are 2px terracotta.
> Editorial section dividers = label + thin hairline rule.
>
> **Layout:** Page max-width 960px; mobile shell 430px. Design **mobile-first** — this is a
> mobile-primary product. Pro-side screens scale up to tablet/desktop.
>
> Output one reference screen showing: color swatches, type scale, buttons
> (primary terracotta / ghost / danger), text input, card, status pill/badge set
> (Pending/Accepted/In progress/Completed/Cancelled), and a section-label divider.

---

## 1. Auth card

**Covers:** login, signup chooser, pro signup, client signup, verify-phone, verify-email,
forgot-password, reset-password (8 pages).

> **Design the Tovis authentication screens, using the established design system.**
> A centered card on the atmospheric espresso background (the "AuthShell"). Mobile-first,
> ~430px shell. Brand wordmark "TOVIS" above the card. Voice is warm and slightly cheeky.
>
> Produce these screens:
>
> 1. **Login** — Title "Login", subtitle "Enter your credentials. Try not to be dramatic
>    about it." Fields: Email, Password (with inline "Forgot password?" link). Buttons:
>    "Login" (primary), "Create an account" (secondary). Footer: "Need help?" → support,
>    helper "No spam. Just bookings." Show the error banner variant ("Email and password
>    are required") and a warning "reason" banner ("Professional account required").
>
> 2. **Signup chooser** — Title "Create your account", subtitle "Pick what you're here to do."
>    Two stacked full-width choices: "I'm a Pro — Offer services" (primary) and
>    "I'm a Client — Book services" (secondary). Footer "Sign in" link.
>
> 3. **Pro signup (3-step wizard)** — Title "Create Pro Account", subtitle "Run your business
>    from your phone — set up takes minutes." Show a "Step X of 3" progress bar with labels
>    "Your work / About you / Account". Step 1: Profession select (Cosmetologist, Barber,
>    Esthetician…), salon-vs-mobile toggle, address/ZIP field with a "Confirmed" timezone
>    badge, optional CA license number. Step 2: First/Last name, Business name, Handle (with
>    live preview), Phone, SMS-consent checkbox card. Step 3: Email, Password ("At least 8
>    characters"), Terms checkbox ("Protected by Turnstile"). Buttons: "Continue" / "Back" /
>    "Create Pro Account".
>
> 4. **Verify phone** — Title "Complete your verification", subtitle "Both phone and email
>    verification are required before full app access." A status card showing Phone: Pending,
>    Email: Verified, Account: Verification incomplete. A 6-digit code input ("123456"), help
>    "Didn't get the text?", tiny buttons "Resend code" / "Wrong number?", a resend cooldown
>    "Resend code in 0:45". Primary "Verify phone".
>
> 5. **Forgot password** — Title "Reset password", subtitle "We'll email you a secure reset
>    link." Email field + "Send reset link". Also show the success state: "Check your inbox /
>    If an account exists for [email], you'll get a reset link shortly."
>
> Use the real label/helper/error copy above. Show field labels in the 10px uppercase mono style.

---

## 2. List / index

**Covers:** pro bookings, pro clients, search/discovery, pro services, admin tables,
looks index, pro media, reviews, notifications (~18 pages).

> **Design the Tovis list/index screens, using the established design system.**
> Card-based lists (not dense tables) — each row is a small card with a 14px radius and a
> 1px hairline border. Mobile-first, scaling to a 960px column on desktop. Header pattern:
> Fraunces title + a mono eyebrow subtitle + a row of filter pills.
>
> Produce these screens:
>
> 1. **Pro bookings** — Title "Bookings", subtitle "Today, upcoming, active, past, and
>    cancelled. (America/Los_Angeles)". Filter pills: All / Pending / Accepted / Active /
>    Completed / Cancelled. Grouped sections "Today", "Upcoming", "Past", "Cancelled" each
>    with an "X total" count. Each booking card: service name (bold), "+ add-ons" line, a
>    status pill (Pending/Accepted/In progress/Completed/Cancelled), optional amber "Payment
>    due" badge, client name + email/phone, date/time + "60 min", a price breakdown
>    (Subtotal / Tax +$ / Tip +$ / **Total $**), and right-side actions "Details & aftercare"
>    + "Resume session". Top-right primary "+ New booking". Empty state "No bookings here yet."
>
> 2. **Pro clients** — Title "Clients", subtitle "Only clients you currently have access to
>    (pending/active/upcoming)." A small "Add a client" form card on top, then the list.
>    Each row: client name (bold), email or "No email", phone, "Last visit: [date]" or
>    "No visits yet"; right-side ghost buttons "Message" + "View chart". "X visible" count.
>    Empty: "No clients with active visibility right now."
>
> 3. **Discovery / search** — A map+grid discovery surface. A horizontal category rail
>    ("All" + categories), a Map/Grid view toggle, and a Distance/Name sort. Grid cards are
>    image-led: pro avatar/photo, business name, distance + closest location, "$X" starting
>    price, "4.8★ (32 reviews)", a Mobile/Salon badge. Empty: "No professionals found."
>    Show both the map view (pins) and the grid view.
>
> Use the real status vocab and copy above. Booking status pill colors: Pending = amber,
> Accepted = terracotta, In progress = acid-lime, Completed = fern, Cancelled = muted/ember.

---

## 3. Detail

**Covers:** pro booking detail, pro client chart, public pro profile, client booking detail,
media detail, looks detail (~12 pages).

> **Design the Tovis detail screens, using the established design system.**
> A hero/summary card at the top, then a grid of titled section cards below
> (each: ◆ mono section label + optional subtitle + content). Tabbed where noted.
>
> Produce these screens:
>
> 1. **Pro booking detail** — Back link "← Back to bookings". Hero card: service name (Fraunces
>    title), status pill, "Client: [First Last]" + email/phone, appointment date/time + "60 min"
>    + timezone badge, right side "Total: $X.XX" and "Booking ID: […]". Section cards:
>    "Aftercare" (subtitle "Snapshot saved on the booking", empty "No aftercare notes yet."),
>    "Timing" (Scheduled / Started / Finished, "—" when empty). A header action "Open session"
>    plus contextual status buttons (Accept / Start / Finish / Cancel).
>
> 2. **Pro client chart** — Back link "← Back to clients", "Visibility: Granted". Hero: client
>    name, email/phone, an optional "⚠ [alert]" warning banner, right-side stats
>    "Total visits / Last visit / Next visit" and buttons "Message" + "+ New booking".
>    Anchor-tab nav: Notes / Allergies / Service history / Products / Reviews they left /
>    Pro feedback. Show the Allergies section (label + severity badge MILD/MODERATE/SEVERE +
>    "Recorded [date] • by [Pro]") and Service history (filter select + search, booking rows
>    with status badge + "Me" badge + aftercare snippet). Empty states like
>    "No notes yet. Start the 'professional memory' file."
>
> 3. **Public pro profile** — A full-bleed hero (avatar/cover image, gradient overlay), with
>    top-right "Share" + "Favorite" actions and "← Back to Looks". Over the hero: @handle,
>    pro name (+ optional premium badge), profession + location + distance, and a stat row
>    "4.8★ (32 reviews) · favorites · completed bookings · from $X". Pill tabs Portfolio /
>    Services / Reviews. Portfolio = image grid. Services = rows with "Salon: $X–$Y", "~45 min",
>    and a "Book" button. Reviews = rating + body + "Helpful" vote. "Message" / "Log in to message".
>
> 4. **Client booking detail** — Hero: service name, "With [Pro]", date/time + timezone +
>    location, status pill, meta pills (duration, subtotal, "In salon"/"Mobile", "Source: Looks",
>    "Action required"). Tabs: Overview / Consultation / Aftercare (the latter two disabled until
>    available, with explanatory tooltips). Overview: a "What's included" card (Base/Add-on items)
>    and a color-coded status alert. Aftercare tab: "Appointment summary", "Before & after" photo
>    cards (with "🔒 These photos are private" note), "Final service breakdown", "Recommended
>    products", "Final cost recap", and a "Payment & checkout" card (status Not ready/Ready/Paid/
>    Waived, method Cash/Card on file/Tap to pay/Venmo…). Include a "Rebook" section and a
>    "Review" form (rating, headline, body, photo upload).
>
> Use the real section titles, status vocab, and copy above.

---

## 4. Dashboard

**Covers:** pro dashboard (analytics), pro home, client home, admin home, professionals
dashboard (~5 pages).

> **Design the Tovis dashboard/home screens, using the established design system.**
>
> 1. **Pro analytics dashboard** — A horizontal month scroller (Jan, Feb…). A big revenue
>    card: mono kicker "◆ JANUARY REVENUE", a large currency value, a trend chip "+15% vs
>    last month", subtitle "from 8 completed bookings". Two 4-up stat grids (label /
>    big value / muted sub like "vs last month"). A "◆ TOP SERVICES · JANUARY" ranked list
>    (rank · service name · "3 bookings" · revenue). Empty: "No completed services for this
>    month yet." Read-only, editorial, data-dense but calm.
>
> 2. **Client home** — Context greeting "Good morning" + client name in large Fraunces italic,
>    an inbox icon top-right. An "Upcoming appointment" card (pro avatar, service, "With [Pro]",
>    schedule, location) OR its empty state ("◆ Nothing booked yet" / "No approved appointments
>    yet." / "When a pro approves your booking, it'll show up here." / "Find a pro"). An action
>    card for "◆ Consultation pending — Review your consultation changes" with "Review & approve"
>    + "View full". Plus rows for last-minute invites, waitlists, favorite pros, and a "Request
>    a Look" card. Two-column on desktop, single column on mobile.
>
> 3. **Admin home** — Title "Admin Dashboard", subtitle about approving pros / managing
>    services. An "Operations" section with a highlighted "NFC Cards" card ("Manage cards",
>    "Tool" badge). A "Core Admin Tools" grid of permission-gated cards: Professionals queue,
>    Services, Categories, Permissions, Runtime flags, Logs — each with a one-line description
>    and CTA. Show the empty-permission state "No admin permissions assigned".

---

## 5. Flow / wizard

**Covers:** pro onboarding, session flow + before/after photos, client consultation token,
client rebook token (~8 pages).

> **Design the Tovis flow/wizard screens, using the established design system.**
> Step-driven, single-focus screens with a clear progress sense (numbered steps or pills),
> a primary forward CTA, and lots of breathing room. Mobile-first with a fixed footer where
> a camera action is needed.
>
> Produce these screens:
>
> 1. **Pro onboarding checklist** — Eyebrow "FINISH SETUP", title "You're almost bookable",
>    subtitle "Clients can't book you until these setup items are done. Knock them out in any
>    order…". A vertical list of numbered blocker items, each: number badge, label (e.g.
>    "Add at least one active service offering.", "Finish Stripe payout setup in your payment
>    settings.", "Finish professional verification."), a destination path in muted text, and a
>    "→" arrow. Footer "Once everything is done you'll land back on your calendar automatically."
>
> 2. **Pro session flow** — A multi-step active-session screen. Header: back link, a mono
>    kicker that changes per step ("◆ SESSION ACTIVE", "⏳ AWAITING APPROVAL", "◆ IN PROGRESS"),
>    title, and "[Client] · [Service] · [Schedule]" subtitle. A 4-step progress bar
>    (Consultation → Before photos → Service → Wrap-up). Show three step states as separate
>    frames: (a) Consultation — "◆ Step 1 · Consultation" card + "Open Consultation Form →",
>    two stat cards TOTAL/DURATION; (b) Service in progress — a big ELAPSED timer, "Started at
>    [time] · 60 min booked", "Finish service →"; (c) Wrap-up — a checklist card (After photos,
>    Aftercare sent, Payment collected, Checkout paid/waived, Consultation approved — each
>    TODO/DONE), a 3-tile photo grid, action row "After photos" (ghost) + "Aftercare" (primary),
>    "Finish closeout →". Fixed footer with a camera button.
>
> 3. **Client consultation (secure link)** — Badge "Secure consultation link", a status pill
>    (APPROVED/REJECTED/PENDING), title = service, "For [Client] · With [Pro]", scheduled
>    date + timezone. A "Proposal" card ("Proposed total: $X", item rows, "Consultation notes").
>    A "Proof and link details" card (created / expires / delivery / proof method). A "Decision"
>    card: "Approve consultation" (primary) + "Decline consultation" (ghost), with the helper
>    "Approving confirms the proposed consultation plan…". Show the loading and error states too
>    ("Consultation link unavailable / This secure link has expired.").
>
> 4. **Client rebook (secure aftercare link)** — Badge "Secure aftercare link", title "Aftercare
>    for [Service]", "With [Pro] · [Location]", "Original appointment: [date] · [tz]", disclaimer
>    "No account required…". Cards: "Aftercare notes", "Before photos" (3-col grid), "After
>    photos", "Appointment details" (Status/Duration/Total), and "Rebook" with "Recommended
>    rebook window: [range]" and a "Book your next appointment" primary button.

---

## 6. Settings / form

**Covers:** client settings, pro locations, pro working hours, pro reminders, pro store (~6 pages).

> **Design the Tovis settings/form screens, using the established design system.**
> Long, sectioned forms grouped into titled cards, each section with a ◆ label + a one-line
> description. Inputs use the 10px uppercase mono labels. Clear primary "Save" + secondary
> "Reset". Toasts for success/error.
>
> Produce these screens:
>
> 1. **Client settings** — Wordmark + "Client settings" badge. Section "Discovery location"
>    (current location chip "Current: [label] • 10 mi" + Clear, a Radius dropdown [5/10/15/25/50],
>    a "ZIP code or city" search with prediction rows). Section "Saved addresses" split into
>    "Search Areas" and "Mobile Service Addresses" — each a list of address cards with a
>    "Default" badge and actions "Make default / Edit / Delete" + an add/edit form. A profile
>    sub-card (First/Last name, Phone, Birthday, Avatar URL, email shown as a badge). Callout
>    "Salon = area okay · Mobile = real address required". Buttons "Reset" + "Save profile".
>    States: "Loading profile…", success "Profile updated.", "No saved service addresses yet."
>
> 2. **Pro locations** — Section "Add a location": Type dropdown (Salon / Suite / Mobile base),
>    optional Name, "Make primary" checkbox, "Minimum advance notice" dropdown (15 min … 48 hrs),
>    then either an address autocomplete (salon) or ZIP + travel-radius (mobile base). A "Your
>    locations" list: each card with a PRIMARY badge, type label, "Not bookable" warning badge,
>    address, and a metadata line "TZ: … • Notice: 2 hrs • Radius: 15 mi", with actions
>    Maps / Directions / Set primary / Delete. A publish-drafts warning card ("X location(s) not
>    bookable yet" + "Publish locations") and a delete-confirm modal. Toasts "Location added" /
>    "Couldn't add location".

---

## 7. Messaging

**Covers:** inbox, thread, start (3 pages).

> **Design the Tovis messaging screens, using the established design system.**
> Mobile-first, ~430px. Warm, intimate, not a corporate chat app.
>
> 1. **Inbox** — Title "Inbox" (large Fraunces italic). Filter tabs All / Bookings / Waitlists /
>    Pros (underline indicator). Thread rows: 64px circular avatar (with unread dot), a colored
>    uppercase eyebrow ("BOOKING CONFIRMED — [service] — [day time]", "WAITLIST — [status] —
>    [service]", "SERVICE — [name]", "PRO"), a person-name title, a last-message preview (or
>    "Say hi…"), and a relative time ("now", "5m", "2h", "Jan 5"). Unread rows are bold. Empty
>    state card "No messages yet / Once a message thread has activity, it will show up here." +
>    "Browse Looks".
>
> 2. **Thread** — Header: mono eyebrow "BOOKING · [service] · [day time]", person-name title, an
>    optional "View booking →" context link, and "← Inbox" top-right. Message bubbles: mine =
>    right-aligned terracotta with light text, theirs = left-aligned bordered card; 22px radius,
>    inline image/video attachments, a small timestamp ("2:45 PM"). Bottom: an auto-growing
>    "Message…" textarea + "Send" button, with a refresh/"Updating…" status line. Empty:
>    "No messages yet. Start it off."

---

## 8. Public / editorial

**Covers:** home, about, faq, terms, privacy, support, pro public profile (p/[handle]) (~8 pages).

> **Design the Tovis public/editorial screens, using the established design system.**
> This is the brand's front door — most editorial, most Fraunces, most atmosphere.
>
> 1. **Home / landing** — Full-height hero on the espresso background with soft terracotta
>    glows and a fine grain overlay. A top bar with the TOVIS wordmark. Category marker
>    "BEAUTY · BOOKING" (with a short rule). A huge serif headline "A New Age / of Self Care"
>    (second line fading in color). Subtitle "Booking and client management for beauty
>    professionals — with a seamless experience for clients to discover looks and book
>    appointments." CTAs "Create Client Account" (primary) + "I'm a professional" (secondary),
>    and a tertiary "Browse looks without an account →". A subtle scroll nudge. Below the fold,
>    a "Who Tovis is for" section: a 2-up of CLIENTS ("Find your perfect look") and
>    PROFESSIONALS ("Run your business"). Minimal footer (wordmark, links About/Support/Privacy/
>    Terms/FAQ, an "SMS policy ↓" disclosure).
>
> 2. **About** — Eyebrow "About", heading "What is Tovis?", an opening paragraph, then two
>    divided sections "What Tovis does" and "How Tovis uses SMS". CTA row "Create client account"
>    + "Pro signup" + "Support". Calm, single 2xl-width column, editorial divider rules.
>
> 3. **FAQ** — Eyebrow "FAQ", heading "Common questions", subtitle "Plain-English answers about
>    Tovis, signup, and transactional SMS." A divided list of Q&A pairs (question bold, answer
>    below). CTA "Go to Support". Same editorial column treatment.
>
> 4. **Pro public profile (vanity /p/handle)** — A compact card: "← Back to Looks" / "Open full
>    profile →", a 64px avatar, pro name, profession + "• [city]", an optional bio, and a
>    "Time zone: …" badge. Also show the unverified state ("This profile is pending verification
>    / We're verifying the professional's license and details. Check back soon.").

---

## 9. Entry / utility

**Covers:** NFC invalid, claim, and the (UI-less) redirect routes t/[cardId], c/[code] (4 pages).

> **Design the Tovis entry/utility screens, using the established design system.**
> Small, centered, calm — these are landing points from NFC taps and invite links.
>
> 1. **NFC invalid** — A PublicTopBar, then a centered max-2xl block: eyebrow "NFC card",
>    heading "This card isn't active", body "The NFC card you tapped is invalid or has been
>    deactivated. If you think this is a mistake, reach out to the professional who gave you the
>    card, or contact support." Links "Go to the homepage" + "Contact support".
>
> 2. **Claim your history** — Eyebrow "Claim your client history", title "[Service] with [Pro]".
>    An "invitation details" block (appointment date/time + timezone, location). A "What this
>    claim keeps together" card ("Your booking history, aftercare, payments, and rebook context
>    stay attached to the same client identity.", with "Email on file" / "Phone on file"). A
>    ready-to-claim action area with "Create client account" / "I already have an account" /
>    "Claim this history". Also show the warning status cards (revoked, already claimed, client
>    mismatch) in the warn tone.
>
> Note: `t/[cardId]` and `c/[code]` are server redirects with no UI — nothing to mock.

---

## Variant map — the remaining pages

Each of these reuses an archetype above. Use a one-line prompt in the same project, e.g.
*"Same as the [archetype] screen, but for [page]: [what's different]."*

| Page | Reuse archetype | Note |
|---|---|---|
| `(auth)/signup/client` | 1 Auth card | Single form (not stepped); ZIP confirm + SMS consent |
| `(auth)/verify-email` | 1 Auth card | Status-driven confirm screen |
| `(auth)/reset-password/[token]` | 1 Auth card | New-password field + Show/Hide |
| `pro/services` | 2 List + 6 Form | Offering manager: salon/mobile price + duration per service |
| `client/bookings` | — | Redirects to `/client` (no UI) |
| `(main)/looks` + `looks/[id]` | 2 List / 3 Detail | Editorial image feed |
| `pro/media`, `pro/media/new`, `pro/media/[id]` | 2 List / 5 Flow / 3 Detail | Portfolio upload |
| `pro/reviews` | 2 List | Review rows |
| `pro/notifications` | 2 List | Notification rows |
| `pro/reminders` | 6 Form | Reminder settings |
| `pro/last-minute`, `pro/trending-services` | 2 List | |
| `pro/calendar` | 4 Dashboard | Day/Week/Month grid (has its own rich brand copy in `lib/brand/brands/tovis.ts`) |
| `pro/store` | 6 Form | |
| `pro/verification` | 5 Flow | Document upload |
| `pro/bookings/new`, `pro/bookings/[id]/aftercare` | 5 Flow / 3 Detail | |
| `pro/bookings/[id]/session/after-photos` | 5 Flow | Same as before-photos |
| `pro/profile`, `professionals/dashboard` | redirect / 4 Dashboard | profile redirects to `/professionals/[id]` |
| `client/me`, `client/aftercare` | 4 Dashboard / 3 Detail | |
| `client/boards/new`, `client/boards/[boardId]` | 6 Form / 3 Detail | Mood boards |
| `client/bookings/[id]/consultation` | 5 Flow | |
| `admin/*` (categories, services, professionals, permissions, runtime-flags, logs, nfc, support) | 2 List / 6 Form | Admin CRUD tables |
| `messages/start` | 7 Messaging | New-thread composer |
| `terms`, `privacy`, `support` | 8 Public | Editorial column |
| `media/[id]` | 3 Detail | Public media view |
| `booking/[id]`, `(main)/booking/add-ons` | 5 Flow | Booking funnel |

---

### Source

All copy, field labels, status vocab, and states above were extracted from the live codebase
(pages under `app/`, brand tokens in `lib/brand/brands/tovis.ts`, global styles in
`app/globals.css`). Regenerate this file if those pages change materially.

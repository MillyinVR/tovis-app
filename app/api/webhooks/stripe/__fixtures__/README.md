# Vendored Stripe webhook fixtures (M13)

These are **verbatim-shaped** Stripe **test-mode** webhook event payloads, used by
`route.wire.test.ts` to pin the webhook route's field extraction against the real
Stripe wire shape rather than the stripped-down objects `route.test.ts` hand-builds
([[wire-shape-vs-mock-drift]]).

Each file is a complete `Stripe.Event` envelope (`object: "event"`, `api_version:
"2026-04-22.dahlia"` — the version `lib/stripe/server.ts` pins) wrapping the FULL
resource object as Stripe delivers it — including the many fields the route ignores,
so the test proves extraction survives the whole payload, not a convenient subset.

The wire test signs each payload's exact bytes with a test webhook secret via
`stripe.webhooks.generateTestHeaderString` and drives it through the route's REAL
`getStripe().webhooks.constructEvent` — so the signature-verify + parse + dispatch
path runs for real; only the write-boundary appliers (the DB effects) are mocked.

**Provenance / honesty:** these are hand-vendored to match Stripe's documented
test-mode payload shapes for API version `2026-04-22.dahlia`, not dumped from a live
`stripe listen` / `stripe trigger` session — this environment has no authenticated
Stripe access (the Stripe MCP + CLI both require a login not available here). They
reproduce the field names, nesting and types Stripe sends; they are NOT a guarantee
that a future Stripe API version won't add/rename a field. If a real capture becomes
available, replace these in place — the test loads whatever JSON is here.

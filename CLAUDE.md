# Tovis — working rules

## House rules (apply to all work)

These are non-negotiable for every change in this repo. Some are enforced by
tooling; some are judgment-only and **must** be self-checked because no guard
will catch them.

- **No type escapes.** Never use `as any`, `as unknown as`, `: any`, or `<any>`.
  Fix the underlying types instead. *Enforced* by `npm run check:static-guards`
  (→ `check:no-type-escape`, baseline-tracked).
- **No duplicate logic.** Search for an existing helper before writing one;
  reuse or extract rather than copy. If you catch yourself repeating logic,
  consolidate it. *Judgment-only — not guarded.*
- **Prisma schema is the single source of truth for data shapes.** Derive types
  from the generated Prisma client; don't hand-redeclare model shapes or write
  around the schema. Backed by `npm run typecheck` plus the write-boundary
  guards (`check:booking-boundary`, `check:lifecycle-field-writes`).
- **Time & timezones go through `lib/time`.** All date/time formatting and
  timezone math import from `@/lib/time` (the single barrel re-exporting
  `lib/timeZone`, `lib/formatInTimeZone`, `lib/bookingTime`,
  `lib/booking/dateTime`, `lib/booking/timeZoneTruth`). Never reach for raw
  `Intl.DateTimeFormat`, `toLocaleDateString`/`toLocaleTimeString`, or a
  date-shaped `toLocaleString` — they skip timezone sanitization and silently
  render in the server's zone (UTC on Vercel). Store instants as UTC; resolve a
  timezone only at the edges. *Enforced* by `check:no-raw-datetime-format`
  (baseline-tracked; migrate entries to `@/lib/time` and shrink the list).
- **UI must follow the white-label rules.**
  - No hardcoded brand strings — user-facing copy comes from `lib/brand`.
    *Enforced* by `check:no-hardcoded-brand-strings`.
  - No raw colors — use the tone utilities (`toneDanger` / `toneSuccess` /
    `toneWarn` / `toneInfo`) and `rgb(var(--…))` tokens that respect
    `[data-mode]`, never raw hex or raw Tailwind color classes.
    ⚠️ **Raw colors are NOT caught by the static guards — self-check them.**

Before pushing any change, run:

```bash
npm run typecheck && npm run lint && npm run check:static-guards
```

plus the relevant `vitest` suites for the code you touched.

## Ship cadence & deploys (standing rule — Tori, 2026-07-08)

Default workflow for every session, no need to ask each time:

- **Commit + open a PR after each session's work.** Branch off `origin/main`,
  one focused PR per repo touched (this repo + `~/Dev/tovis-ios` when the change
  spans both). Commit **only your own files** — sibling sessions share these
  trees, so never stage another session's changes (e.g. a `BACKLOG.md` you didn't
  edit).
- **Watch CI and merge when green.** Keep an eye on the checks; once they pass,
  merge the PR. If CI fails, fix it (or surface it) — don't leave a red PR.
- **Keep everything aligned.** When a feature spans web + iOS, land both sides
  together; after merge, fast-forward local `main` to `origin/main` in each repo
  so the next session starts clean (the session-sync rule below still holds).
- **🚫 NEVER deploy to Vercel until Tori explicitly says so.** Do **not** run
  `npx vercel --prod` (or any prod deploy) after a merge, even though merged web
  changes won't be live until then. Merging is fine; deploying is Tori's call.
  Auto-deploy is off by design (`vercel.json` `git.deploymentEnabled: false`,
  PR #237) — leave it off. When web work merges, note that a prod deploy is
  pending Tori's go-ahead and stop there.

## Session sync with `origin/main`

The local checkout must be **in sync with `origin/main`** at both the start and
end of every working session. "In sync" means BOTH:

1. **Working tree is clean** — no uncommitted or untracked changes.
2. **Local `main` is level with `origin/main`** — not ahead, not behind, checked
   after a `git fetch`.

### Start of session

A `SessionStart` hook runs `scripts/git-sync-check.sh` automatically and prints
the result. Read it before doing anything else.

- If it reports **in sync** → proceed.
- If it reports **other session(s) active** → another Claude Code session for
  this project is live (its transcript was touched in the last ~5 min), so a
  dirty tree is most likely *its* work. The check does **not** flag out-of-sync
  in that case — proceed, but don't clobber the other session's changes.
- If it reports **NOT in sync** → reconcile first. Typically:
  - dirty working tree → review the changes, then commit on a branch / stash /
    discard as appropriate (never blindly discard — look at what's there first);
  - local `main` behind `origin/main` → `git checkout main && git pull --ff-only`;
  - local `main` ahead/diverged → figure out why before pushing or resetting.

Surface any drift to the user rather than silently "fixing" it.

### End of session

Before wrapping up, leave the checkout in sync again. Run the check by hand:

```bash
bash scripts/git-sync-check.sh
```

Then ensure it reports **in sync ✅** — commit & push outstanding work (on its
branch), get it merged, and fast-forward local `main` to `origin/main` so the
next session starts clean. If something can't be reconciled, tell the user what
remains and why instead of leaving it silently dirty.

> Feature branches legitimately diverge from `origin/main` mid-work — that's
> expected. The hard requirement is the two checks above (clean tree + local
> `main` level with `origin/main`); the current-branch ahead/behind line is
> informational context, not a failure.

### Knobs

- `TOVIS_SKIP_SYNC_CHECK=1` — skip the check entirely (escape hatch).
- `TOVIS_SYNC_CONCURRENCY_WINDOW=<seconds>` — how recently a sibling session's
  transcript must have been written to count as "active" (default `300`).
- Concurrent-session detection only applies when the check runs from the
  `SessionStart` hook (it reads the session payload). A manual
  `bash scripts/git-sync-check.sh` run is always **strict** — which is what you
  want for the end-of-session check.

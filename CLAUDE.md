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

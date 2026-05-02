# Phase 0 Baseline - Repo Stabilization

Commit audited from: b476001
Branch: audit/phase-0-repo-stabilization

## Repo hygiene changes

- Removed `server.log` from git tracking.
- Added local log patterns to `.gitignore`.
- Removed corrupted/junk tracked files:
  - tracked corrupted file beginning with `ecurity patch`
  - `on package-lock.json`
- Removed `package-lock.json`.
- Kept `pnpm-lock.yaml` as the single lockfile.
- Added `.npmrc` with strict package manager settings.
- Confirmed `.env*` files are not tracked.

## Baseline command results

### `pnpm install --frozen-lockfile`

Result: PASS

Notes:

- Lockfile was up to date.
- Prisma Client generated successfully.
- pnpm warned that dependency build scripts require approval via `pnpm approve-builds`. This is not being changed in Phase 0.

### `pnpm typecheck`

Result: FAIL

Summary:

- 5 TypeScript errors.
- Errors are in Looks-related tests:
  - `app/(main)/looks/_components/LooksFeed.test.tsx`
  - `lib/looks/mappers.test.ts`
- Root issue appears to be `viewerSaved` being required by the DTO/mapper type but missing or possibly undefined in test fixtures.

Phase 0 decision:

- Recorded as baseline failure.
- Not fixed in Phase 0.

### `pnpm lint`

Result: FAIL

Summary:

- 3,253 total lint problems.
- 360 errors.
- 2,893 warnings.
- Major categories:
  - Generated/report files under `playwright-report` are being linted.
  - CommonJS `.cjs` seed/test scripts are failing `@typescript-eslint/no-require-imports`.
  - A few test files contain `any` or unused values.

Phase 0 decision:

- Recorded as baseline failure.
- Not fixed in Phase 0.
- Follow-up likely needed to exclude generated reports from lint and decide CJS script lint policy.

### `pnpm test`

Result: FAIL

Summary:

- 207 test files total.
- 204 passed.
- 3 failed.
- 2,071 tests total.
- 2,060 passed.
- 11 failed.
- Failures are Looks/feed-related:
  - `lib/looks/parsers.test.ts`
  - `lib/search/looks.test.ts`
  - `app/(main)/looks/_components/LooksFeed.test.tsx`

Phase 0 decision:

- Recorded as baseline failure.
- Not fixed in Phase 0.

## Phase 0 status

Repo hygiene cleanup is complete pending final commit.

Remaining before Phase 0 can be marked complete:

- Commit Phase 0 cleanup.
- Confirm working tree is clean after commit.

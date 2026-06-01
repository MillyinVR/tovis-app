# Privacy Request Runbook

_Last updated: 2026-05-31_

## Purpose

This runbook documents the Phase 1 operational flow for user privacy requests in TOVIS.

It covers:

- User data export
- Deletion/anonymization dry run
- Live deletion/anonymization
- Required admin permissions
- Audit logging expectations
- Export file handling and retention
- Known limitations carried past Phase 1

Phase 1 uses internal admin-only routes backed by the canonical privacy boundaries:

- `lib/privacy/exportUserData.ts`
- `lib/privacy/deleteUserData.ts`

Do not re-create export/delete traversal logic in route handlers, scripts, admin pages, or one-off SQL unless this runbook is updated and the privacy boundary tests are updated too.

---

## Required access

Only admins with `AdminPermissionRole.SUPER_ADMIN` may run privacy export or delete/anonymization requests.

Both internal routes require:

1. Authenticated user with `Role.ADMIN`
2. `SUPER_ADMIN` permission
3. `Cache-Control: no-store`
4. Admin audit log entry

Routes:

```txt
POST /api/internal/privacy/export/:userId
POST /api/internal/privacy/delete/:userId
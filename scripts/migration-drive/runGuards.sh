#!/bin/bash
# Run every static guard directly with node (bypasses the pnpm engine gate,
# which fails on Node 20 — see CLAUDE.md / memory).
set -uo pipefail
cd "$(dirname "$0")/../.."  # repo root

guards=(
  booking-write-boundary
  booking-status-labels
  calendar-block-cache-bump
  waitlist-status-boundary
  rate-limit-buckets-wired
  sms-send-guarded
  claim-invite-guarded
  media-render-boundary
  consultation-canonical
  lifecycle-field-writes
  no-type-escape
  no-private-lib-fork
  no-prisma-enum-shadow
  canonical-normalization
  pii-plaintext-reads
  tenant-aware-discovery
  no-hardcoded-brand-strings
  brand-resolution
  no-raw-datetime-format
  locale-pinned
  no-bare-tint-token
  no-raw-color
  no-unbracketed-arbitrary-value
  notification-kick
  api-schema
  ios-fixture-contract
  ci-coverage
)

fail=0
for g in "${guards[@]}"; do
  if node "tools/check-$g.mjs"; then
    echo "PASS $g"
  else
    echo "FAIL $g"
    fail=1
  fi
done
exit $fail

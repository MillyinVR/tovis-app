#!/usr/bin/env bash
#
# git-sync-check.sh — verify the local checkout is in sync with origin/main.
#
# "In sync" means BOTH of:
#   1. Working tree is clean (no uncommitted / untracked changes).
#   2. Local `main` is level with `origin/main` (not ahead, not behind),
#      measured after a fetch.
#
# It also reports where the current branch sits relative to origin/main.
#
# Concurrent sessions: if another Claude Code session for this project appears
# to be active (its transcript was written in the last few minutes), a dirty
# tree is probably that session's work — so we DOWNGRADE the result to an
# informational note instead of nagging about being out of sync.
#
# Escape hatch: set TOVIS_SKIP_SYNC_CHECK=1 to skip entirely.
#
# This is informational only: it always exits 0 so it never blocks a session.
# Used by the SessionStart hook (see .claude/settings.local.json) and can be
# run by hand at the end of a session: `bash scripts/git-sync-check.sh`.

set -uo pipefail

if [ "${TOVIS_SKIP_SYNC_CHECK:-}" = "1" ]; then
  echo "git-sync-check: skipped (TOVIS_SKIP_SYNC_CHECK=1)."
  exit 0
fi

# SessionStart hooks pass a JSON payload on stdin (session_id, transcript_path,
# cwd, ...). Capture it if present so we can detect sibling sessions. Reads
# without blocking when there is no stdin (manual runs).
STDIN_JSON=""
if [ ! -t 0 ]; then
  STDIN_JSON="$(cat 2>/dev/null || true)"
fi

# Window (seconds) within which a sibling transcript counts as "active".
CONCURRENCY_WINDOW="${TOVIS_SYNC_CONCURRENCY_WINDOW:-300}"

# Returns the number of OTHER session transcripts in this project touched within
# the window. Empty/0 when we can't tell (e.g. manual run with no stdin).
count_sibling_sessions() {
  [ -n "$STDIN_JSON" ] || { echo 0; return; }
  # Pass the payload via env (NOT stdin) — the heredoc below is python's stdin.
  SYNC_STDIN_JSON="$STDIN_JSON" CONCURRENCY_WINDOW="$CONCURRENCY_WINDOW" python3 - <<'PY' 2>/dev/null || echo 0
import json, os, sys, time
try:
    data = json.loads(os.environ.get("SYNC_STDIN_JSON", ""))
except Exception:
    print(0); sys.exit()
tpath = data.get("transcript_path") or ""
self_id = data.get("session_id") or ""
proj = os.path.dirname(tpath)
if not proj or not os.path.isdir(proj):
    print(0); sys.exit()
window = float(os.environ.get("CONCURRENCY_WINDOW", "300"))
now = time.time()
n = 0
for name in os.listdir(proj):
    if not name.endswith(".jsonl"):
        continue
    if self_id and name == f"{self_id}.jsonl":
        continue
    try:
        if now - os.stat(os.path.join(proj, name)).st_mtime <= window:
            n += 1
    except OSError:
        pass
print(n)
PY
}

# Resolve repo root so this works regardless of CWD.
ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "git-sync-check: not inside a git repository — skipping."
  exit 0
}
cd "$ROOT" || exit 0

echo "── git sync check ────────────────────────────────"

# Fetch quietly; tolerate offline.
if ! git fetch --quiet origin 2>/dev/null; then
  echo "⚠️  could not fetch origin (offline?) — comparing against last-known refs."
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null)"
echo "branch: ${BRANCH:-<detached>}"

PROBLEMS=0

# 1) Working tree clean?
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "❌ working tree DIRTY — uncommitted or untracked changes:"
  git status --short 2>/dev/null | sed 's/^/     /'
  PROBLEMS=$((PROBLEMS + 1))
else
  echo "✅ working tree clean"
fi

# 2) Local main level with origin/main?
if git show-ref --verify --quiet refs/heads/main; then
  LOCAL_MAIN="$(git rev-parse main 2>/dev/null)"
  REMOTE_MAIN="$(git rev-parse origin/main 2>/dev/null)"
  if [ -n "$REMOTE_MAIN" ] && [ "$LOCAL_MAIN" = "$REMOTE_MAIN" ]; then
    echo "✅ local main == origin/main"
  else
    AHEAD="$(git rev-list --count origin/main..main 2>/dev/null || echo '?')"
    BEHIND="$(git rev-list --count main..origin/main 2>/dev/null || echo '?')"
    echo "❌ local main DIVERGED from origin/main (ahead ${AHEAD}, behind ${BEHIND})"
    PROBLEMS=$((PROBLEMS + 1))
  fi
else
  echo "ℹ️  no local main branch to compare."
fi

# 3) Where does the current branch sit vs origin/main? (context, not a failure)
if [ "$BRANCH" != "main" ] && git rev-parse --verify --quiet origin/main >/dev/null; then
  C_AHEAD="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo '?')"
  C_BEHIND="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo '?')"
  echo "ℹ️  ${BRANCH} vs origin/main: ahead ${C_AHEAD}, behind ${C_BEHIND}"
fi

if [ "$PROBLEMS" -eq 0 ]; then
  echo "→ in sync with origin/main ✅"
else
  SIBLINGS="$(count_sibling_sessions)"
  if [ "${SIBLINGS:-0}" -gt 0 ] 2>/dev/null; then
    echo "→ ⚠️  ${SIBLINGS} other session(s) active (transcript touched < ${CONCURRENCY_WINDOW}s ago)."
    echo "   Not flagging out-of-sync — another session likely owns these changes."
  else
    echo "→ NOT in sync ($PROBLEMS issue(s)) — reconcile before/at end of session."
  fi
fi
echo "──────────────────────────────────────────────────"

exit 0

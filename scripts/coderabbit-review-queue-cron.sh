#!/usr/bin/env bash
# Hourly cron entry point for the CodeRabbit review queue, e.g.:
#   17 * * * * /path/to/jot-deck/scripts/coderabbit-review-queue-cron.sh
# Runs the queue script as published on origin/main, so whatever branch is
# checked out in this working tree does not affect it.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/jot-deck"
log_file="$state_dir/coderabbit-review-queue.log"
max_log_bytes=$((1024 * 1024))

mkdir -p "$state_dir"
if [ -f "$log_file" ] && [ "$(stat -c %s "$log_file")" -gt "$max_log_bytes" ]; then
  tail -n 2000 "$log_file" > "$log_file.tmp" && mv "$log_file.tmp" "$log_file"
fi
exec >> "$log_file" 2>&1

# cron starts with a minimal PATH; pick up mise-managed node and gh.
export PATH="$HOME/.local/share/mise/shims:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"
if command -v mise > /dev/null; then
  eval "$(mise env --cd "$repo_root" -s bash)"
fi

exec 9> "$state_dir/coderabbit-review-queue.lock"
if ! flock -n 9; then
  echo "$(date -u +%FT%TZ) INFO previous run still in progress; skipping"
  exit 0
fi

cd "$repo_root"
git fetch --quiet origin main

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
for file in coderabbit-review-queue.js coderabbit-review-queue.mjs; do
  git show "origin/main:scripts/$file" > "$work_dir/$file"
done

node "$work_dir/coderabbit-review-queue.mjs"

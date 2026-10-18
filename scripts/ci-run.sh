#!/usr/bin/env bash
# Run a command; if it fails, surface the important part of its output as GitHub
# annotations so failures are readable without opening raw logs.
#   usage: ci-run.sh "Title" command args...
#   env:   CI_EXTRA_LOG (path to another log file to tail on failure)
set -uo pipefail
title="$1"; shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status="${PIPESTATUS[0]}"

# annotate <title> <text>   (keeps the END of the text; annotations are size-limited)
annotate() {
  local msg
  msg="$(printf '%s' "$2" | tail -c 3000)"
  msg="${msg//'%'/'%25'}"; msg="${msg//$'\r'/'%0D'}"; msg="${msg//$'\n'/'%0A'}"
  echo "::error title=$1::${msg}"
}

if [ "$status" -ne 0 ]; then
  errors="$(grep -n -iE 'error|\*\*\*|fatal|undefined|not found|cannot|failed|No such' "$log" | cut -c1-220 | tail -n 15 || true)"
  [ -n "$errors" ] && annotate "$title: error lines" "$errors"
  annotate "$title: last lines (exit $status)" "$(tail -n 25 "$log" | cut -c1-180)"
  if [ -n "${CI_EXTRA_LOG:-}" ] && [ -f "$CI_EXTRA_LOG" ]; then
    annotate "$title: extra log" "$(tail -n 25 "$CI_EXTRA_LOG" | cut -c1-180)"
  fi
fi
exit "$status"

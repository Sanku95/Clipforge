#!/usr/bin/env bash
# Run a command; if it fails, surface the tail of its output (and optionally another
# log file) as GitHub annotations so failures are readable without opening raw logs.
#   usage: ci-run.sh "Title" command args...
#   env:   CI_TAIL (lines, default 50), CI_EXTRA_LOG (path to an extra log to tail)
set -uo pipefail
title="$1"; shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
status="${PIPESTATUS[0]}"

annotate() { # $1=title $2=file $3=lines
  local msg
  msg="$(tail -n "$3" "$2" | cut -c1-300)"
  msg="${msg//'%'/'%25'}"; msg="${msg//$'\r'/'%0D'}"; msg="${msg//$'\n'/'%0A'}"
  echo "::error title=$1::${msg}"
}

if [ "$status" -ne 0 ]; then
  annotate "$title failed (exit $status)" "$log" "${CI_TAIL:-50}"
  if [ -n "${CI_EXTRA_LOG:-}" ] && [ -f "$CI_EXTRA_LOG" ]; then
    annotate "$title: extra log" "$CI_EXTRA_LOG" 40
  fi
fi
exit "$status"

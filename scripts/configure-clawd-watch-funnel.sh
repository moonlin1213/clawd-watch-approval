#!/bin/bash
set -euo pipefail
apply=false
port=23940
while [[ $# -gt 0 ]]; do
  case "$1" in
    --apply) apply=true; shift ;;
    --port) port="${2:?missing port}"; shift 2 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
  esac
done
[[ "$port" =~ ^2394[0-9]$ ]] || { printf 'Watch port must be 23940-23949\n' >&2; exit 2; }
cli="${CLAWD_TAILSCALE_BIN:-/usr/local/bin/tailscale}"
target="http://127.0.0.1:$port/api/clawd-watch/v1"
printf 'Single mount: /api/clawd-watch/v1 -> %s\n' "$target"
if [[ "$apply" == true ]]; then
  "$cli" funnel status --json
  "$cli" funnel --bg --yes --https=443 --set-path=/api/clawd-watch/v1 "$target"
else
  printf 'Preview only. Use --apply after reviewing the current Funnel and gateway status.\n'
fi

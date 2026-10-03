#!/bin/bash
set -euo pipefail
base="${1:?Usage: verify-clawd-watch-boundary.sh https://hostname}"
[[ "$base" =~ ^https://[a-zA-Z0-9.-]+$ ]] || { printf 'Expected HTTPS hostname without path\n' >&2; exit 2; }
check() {
  local route="$1" expected="$2" status
  status=$(curl --path-as-is --silent --show-error --max-time 12 --output /dev/null --write-out '%{http_code}' "$base$route")
  printf '%s %s\n' "$status" "$route"
  [[ "$status" == "$expected" ]]
}
check /api/clawd-watch/v1/approvals 401
check /api/clawd-watch/v1/state 404
check /api/clawd-watch/v1/permission 404
check /api/clawd-watch/v1/admin/settings 404
check /api/clawd-watch/v1/%2e%2e/permission 404
check /admin/settings 404
check /api/safety/current 404

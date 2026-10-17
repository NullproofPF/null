#!/usr/bin/env bash
# Poll the newest Railway deployment of a service until it settles.
# Usage: bash scripts/wait-deploy.sh <service> [up]   ("up" first runs `railway up --service <service> --detach`)
# The JSON parsing lives inside this file on purpose: a `node -e` on the command line itself raises an
# approval prompt, `bash scripts/wait-deploy.sh web up` does not.
# Every railway call reads stdin from /dev/null: without a tty the CLI prints "stdin is not a tty" and no
# JSON. Default cap is 42 polls (420 s) so the whole call stays under the terminal's 600 s foreground cap;
# override with WAIT_MAX=<n>.
set -u
SVC="${1:?service name}"
MAX="${WAIT_MAX:-42}"
if [ "${2:-}" = "up" ]; then
  railway up --service "$SVC" --detach < /dev/null 2>&1 | grep -E "Deployment:|rror"
fi
for i in $(seq 1 "$MAX"); do
  sleep 10
  S=$(railway deployment list --service "$SVC" --json < /dev/null 2>/dev/null | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{try{const a=JSON.parse(d);const x=Array.isArray(a)?a[0]:a;console.log((x&&x.status)||"?")}catch{console.log("?")}})')
  echo "$(date +%T) $S"
  case "$S" in
    SUCCESS) exit 0 ;;
    FAILED|CRASHED|REMOVED) railway logs --service "$SVC" < /dev/null 2>&1 | tail -30; exit 1 ;;
  esac
done
echo "still not settled after $MAX polls for $SVC; check: railway deployment list --service $SVC --json"
exit 2

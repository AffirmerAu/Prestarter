#!/usr/bin/env bash
# Spec section 10 automatic transitions, run via the nightly Cron Worker
# (worker/src/billing-cron.ts). Needs `wrangler dev --test-scheduled` running locally.
#
# Usage: ./at-billing-cron.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

SUPABASE_URL=$(grep '^SUPABASE_URL=' .dev.vars | cut -d= -f2)
SERVICE_KEY=$(grep '^SUPABASE_SERVICE_ROLE_KEY=' .dev.vars | cut -d= -f2)
CLIENT_ID=$(node -e "console.log(JSON.parse(require('fs').readFileSync('../supabase/seed/test-orgs.json'))['Acme Pty Ltd'].clientId)")
WORKER_URL="${WORKER_URL:-http://127.0.0.1:8787}"

patch() { curl -s -X PATCH "$SUPABASE_URL/rest/v1/clients?id=eq.$CLIENT_ID" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" -H "Content-Type: application/json" -d "$1" >/dev/null; }
state() { curl -s "$SUPABASE_URL/rest/v1/clients?id=eq.$CLIENT_ID&select=billing_state" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" | node -e "process.stdin.on('data',d=>console.log(JSON.parse(d)[0].billing_state))"; }
run_cron() { curl -s "$WORKER_URL/__scheduled?cron=0+16+*+*+*" >/dev/null; sleep 2; } # ctx.waitUntil() means the HTTP response doesn't wait for the background transitions to finish

fail=0

# Just past paid_to, well within the 30-day grace — should land on 'due', not 'overdue'.
FIVE_DAYS_AGO=$(node -e "const d=new Date(); d.setDate(d.getDate()-5); console.log(d.toISOString().slice(0,10))")
patch "{\"billing_state\":\"paid\",\"paid_to\":\"$FIVE_DAYS_AGO\"}"
run_cron
result=$(state)
if [[ "$result" == "due" ]]; then echo "PASS  5 days past paid_to -> due"; else echo "FAIL  5 days past paid_to -> $result (expected due)"; fail=1; fi

# Long past paid_to + grace_days — a single run should catch up straight to 'overdue',
# not get stuck at 'due' for an extra day.
patch '{"billing_state":"paid","paid_to":"2020-01-01"}'
run_cron
result=$(state)
if [[ "$result" == "overdue" ]]; then echo "PASS  long overdue -> overdue in one pass"; else echo "FAIL  long overdue -> $result (expected overdue)"; fail=1; fi

# Restore clean baseline for other tests.
ONE_YEAR_OUT=$(node -e "const d=new Date(); d.setFullYear(d.getFullYear()+1); console.log(d.toISOString().slice(0,10))")
patch "{\"billing_state\":\"paid\",\"paid_to\":\"$ONE_YEAR_OUT\",\"status\":\"active\"}"

exit $fail

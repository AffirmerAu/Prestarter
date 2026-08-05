#!/usr/bin/env bash
# AT2 (spec section 18): a token older than 120 seconds is refused.
#
# Written from an empirical finding, not the spec's assumption taken on faith (see
# AT24-fullscreen-watermark.md for the sibling case of an amendment done the same way).
# Verified manually against a real Cloudflare Stream account: Cloudflare re-validates the
# `exp` claim on EVERY request, not just the first — the master manifest, each variant
# playlist, AND each individual segment (segment URLs each carry their own copy of the same
# `exp`, baked in when the manifest was generated). A segment URL that worked before expiry
# returns 401 if re-requested after. So "refused" here is checked at all three levels, not
# just "can't start a new session" — a spec assumption that turned out to already be correct,
# confirmed rather than assumed.
#
# This script uses a short custom expiry (default 25s, not the real 120s) so the test runs
# in well under a minute rather than waiting for two real minutes. That's testing the same
# mechanism Cloudflare enforces regardless of the exact expiry value.
#
# Needs a real Stream account: reads CF_ACCOUNT_ID, CF_STREAM_API_TOKEN, STAGE1_VIDEO_UID,
# STREAM_CUSTOMER_CODE from worker/.dev.vars (gitignored, never committed).
#
# Usage: ./at2-expired-token-refused.sh [short_exp_seconds]
set -euo pipefail
cd "$(dirname "$0")/../.."

SHORT_EXP_SECONDS="${1:-25}"

ACCOUNT_ID=$(grep '^CF_ACCOUNT_ID=' .dev.vars | cut -d= -f2)
API_TOKEN=$(grep '^CF_STREAM_API_TOKEN=' .dev.vars | cut -d= -f2)
UID_=$(grep '^STAGE1_VIDEO_UID=' .dev.vars | cut -d= -f2)
CODE=$(grep '^STREAM_CUSTOMER_CODE=' .dev.vars | cut -d= -f2)

fail=0
now=$(date +%s)
exp=$(( now + SHORT_EXP_SECONDS ))

mint_response=$(curl -s -X POST \
  "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/stream/$UID_/token" \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d "{\"exp\": $exp}")
token=$(echo "$mint_response" | grep -o '"token": *"[^"]*"' | sed 's/"token": *"//;s/"$//')
if [[ -z "$token" ]]; then
  echo "FAIL  could not mint a token: $mint_response"
  exit 1
fi
echo "minted token, exp in ${SHORT_EXP_SECONDS}s"

master_url="https://customer-$CODE.cloudflarestream.com/$token/manifest/video.m3u8"

master_before=$(curl -s -o /tmp/at2_master.m3u8 -w "%{http_code}" "$master_url")
if [[ "$master_before" != "200" ]]; then
  echo "FAIL  master manifest before expiry -> $master_before (expected 200)"
  exit 1
fi
echo "PASS  master manifest before expiry -> 200"

variant=$(awk '/#EXT-X-STREAM-INF/{getline; print; exit}' /tmp/at2_master.m3u8)
variant_url="https://customer-$CODE.cloudflarestream.com/$token/manifest/$variant"
curl -s -o /tmp/at2_variant.m3u8 "$variant_url"

seg_rel=$(awk '/^#EXTINF/{getline; print; exit}' /tmp/at2_variant.m3u8)
seg_path_and_query=$(echo "$seg_rel" | sed 's#^\.\./\.\./##')
seg_url="https://customer-$CODE.cloudflarestream.com/$seg_path_and_query"

seg_before=$(curl -s -o /dev/null -w "%{http_code}" "$seg_url")
if [[ "$seg_before" != "200" ]]; then
  echo "FAIL  segment fetch before expiry -> $seg_before (expected 200)"
  exit 1
fi
echo "PASS  segment fetch before expiry -> 200"

sleep_for=$(( SHORT_EXP_SECONDS - ($(date +%s) - now) + 5 ))
echo "waiting ${sleep_for}s for the token to pass its exp..."
sleep "$sleep_for"

check_after() {
  local label="$1" url="$2"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  if [[ "$code" == "401" ]]; then
    echo "PASS  $label after expiry -> 401"
  else
    echo "FAIL  $label after expiry -> $code (expected 401)"
    fail=1
  fi
}

check_after "master manifest"        "$master_url"
check_after "variant playlist"       "$variant_url"
check_after "previously-valid segment" "$seg_url"

rm -f /tmp/at2_master.m3u8 /tmp/at2_variant.m3u8
exit $fail

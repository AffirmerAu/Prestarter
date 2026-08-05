#!/usr/bin/env bash
# AT1 (spec section 18): a direct Cloudflare Stream URL, without a token, is refused.
#
# Needs a real Stream account. Reads STREAM_CUSTOMER_CODE and STAGE1_VIDEO_UID from
# worker/.dev.vars (gitignored, never committed) so no secret is pasted into this script.
#
# Usage: ./at1-raw-url-refused.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

CODE=$(grep '^STREAM_CUSTOMER_CODE=' .dev.vars | cut -d= -f2)
UID_=$(grep '^STAGE1_VIDEO_UID=' .dev.vars | cut -d= -f2)

fail=0

check() {
  local label="$1" url="$2" expect_range="$3"
  local code
  code=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  if [[ "$code" =~ $expect_range ]]; then
    echo "PASS  $label -> $code"
  else
    echo "FAIL  $label -> $code (expected $expect_range)"
    fail=1
  fi
}

# Raw manifest URL using the bare video UID instead of a signed token — must be refused.
check "raw unsigned manifest" \
  "https://customer-$CODE.cloudflarestream.com/$UID_/manifest/video.m3u8" \
  '^40[13]$'

# Raw iframe embed using the bare video UID — must also be refused.
check "raw unsigned iframe" \
  "https://customer-$CODE.cloudflarestream.com/$UID_/iframe" \
  '^40[13]$'

exit $fail

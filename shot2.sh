#!/bin/bash
# usage: shot2.sh <url-path> <out.png> <budget-seconds> [WxH]
# default is near-square (9:8) for the blog; pass WxH to override
URL="http://localhost:8017$1"
OUT="$2"
BUDGET="${3:-6}"
SIZE="${4:-1080,960}"
chromium --headless --disable-gpu --no-sandbox --hide-scrollbars --window-size=$SIZE --virtual-time-budget=$((BUDGET*1000)) --screenshot="$OUT" "$URL" 2>/dev/null

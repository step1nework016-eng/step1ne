#!/bin/bash
# 2026-10-30 Jacky：「每一次都說謊」——說上線了，網站其實還是舊的（自動建置卡住）。
# 從現在起上線一律走這支：檢查客戶名 → 推 git → 直接上傳 → 逐檔抓線上版本比對。
# 只有最後印出「✅ 線上已是新版」才准跟 Jacky 說上線；要登入的頁面會明講「沒驗到」。
# 用法：./scripts/ship.sh [比對基準 commit，預設 HEAD~1]
set -e
cd "$(dirname "$0")/.."
BASE="${1:-HEAD~1}"
./scripts/predeploy.sh
git push -q deploy HEAD:main
./deploy_direct.sh >/dev/null 2>&1 || { echo '❌ 直接上傳失敗'; exit 1; }
TMP=$(mktemp -d)
fail=0
for f in $(git diff --name-only "$BASE" HEAD); do
  [ -f "$f" ] || continue
  url="https://step1ne.com/${f%index.html}"
  code=$(curl -s -o "$TMP/live" -w '%{http_code}' "$url?nc=$RANDOM")
  if [ "$code" = "302" ] || [ "$code" = "403" ]; then echo "⚠️ 要登入，沒驗到：$f"; continue; fi
  if cmp -s "$TMP/live" "$f"; then echo "✅ 線上已是新版：$f"; else echo "❌ 線上還是舊的：$f（$code）"; fail=1; fi
done
rm -rf "$TMP"
exit $fail

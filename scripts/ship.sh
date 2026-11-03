#!/bin/bash
# 2026-10-30 Jacky：「每一次都說謊」——說上線了，網站其實還是舊的（自動建置卡住）。
# 從現在起上線一律走這支：檢查客戶名 → 推 git → 直接上傳 → 逐檔抓線上版本比對。
# 只有最後印出「✅ 線上已是新版」才准跟 Jacky 說上線；要登入的頁面會明講「沒驗到」。
# 用法：./scripts/ship.sh [比對基準 commit，預設 HEAD~1]
set -e
cd "$(dirname "$0")/.."
BASE=$(git rev-parse "${1:-HEAD~1}")
# 2026-11-02 Jacky「職缺要讓 AI 抓得到」：每次上線前重產給 AI 看的目錄（llms.txt），有變就一起帶上去
python3 scripts/gen_llms_txt.py >/dev/null
python3 scripts/add_sticky_cta.py >/dev/null
if ! git diff --quiet -- articles; then git add articles && git commit -qm "文章頁補底部常駐按鈕（上線前自動補）"; fi
if ! git diff --quiet -- llms.txt; then git add llms.txt && git commit -qm "llms.txt 自動更新（上線前重產）"; fi
./scripts/predeploy.sh
git push -q deploy HEAD:main
./deploy_direct.sh >/dev/null 2>&1 || { echo '❌ 直接上傳失敗'; exit 1; }
TMP=$(mktemp -d)
fail=0
for f in $(git diff --name-only "$BASE" HEAD); do
  [ -f "$f" ] || continue
  # 內部程式與草稿不上線（deploy_direct.sh 排除），不用比對
  case "$f" in scripts/*|*.py|*.sh|CLAUDE.md|DEPLOY.md|_tmp_preview.html|redesign-*.html|缺圖清單.html) continue;; esac
  url="https://step1ne.com/${f%index.html}"
  code=$(curl -s -o "$TMP/live" -w '%{http_code}' "$url?nc=$RANDOM")
  if [ "$code" = "302" ] || [ "$code" = "403" ]; then echo "⚠️ 要登入，沒驗到：$f"; continue; fi
  if cmp -s "$TMP/live" "$f"; then echo "✅ 線上已是新版：$f"; else echo "❌ 線上還是舊的：$f（$code）"; fail=1; fi
done
rm -rf "$TMP"
# 2026-11-02：上線後跑一次系統巡檢（客戶專區、顧問後台網頁、人選名單…）；有問題巡檢會私訊 Jacky。沒有 patrol.env 就跳過。
if [ -f ~/.config/workflow-os/patrol.env ]; then
  source ~/.config/workflow-os/patrol.env
  sleep 5
  curl -s -m 120 -X POST "$PATROL_URL/run?why=deploy-site" -H "X-Patrol-Key: $PATROL_RUN_KEY" | python3 -c '
import json, sys
try: d = json.load(sys.stdin)
except Exception: print("⚠️ 上線後巡檢沒跑成功，請手動確認"); sys.exit()
p = [x["what"] for r in d.get("results", []) for x in r.get("problems", [])]
print("✅ 上線後巡檢全部通過" if not p else "❌ 上線後巡檢發現問題（已私訊 Jacky）：\n" + "\n".join("   - " + x for x in p))' || true
fi
exit $fail

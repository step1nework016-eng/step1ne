#!/bin/bash
# 部署前一定要跑這支。目前只有一道關：客戶名稱不得出現在對外網站。
#
# 2026-09-21 建。那天對外職缺頁把客戶簡稱印在卡片上，同一次掃描還找到
# 4 個公開可讀、整頁都是客戶名的內部頁面。Jacky 問「為什麼一直在修單點
# 事件」——因為從來沒有任何程式在送出去之前檢查過。這支就是那道檢查。
#
# 2026-09-24 改：Windows 上 python3 是微軟商店的空殼、也沒有 npx，
# 原本會「檢查沒跑卻顯示通過」。現在先確認 Python 真的能執行，找不到就擋下。
set -e
cd "$(dirname "$0")/.."
[ -f ~/.config/workflow-os/cf.env ] && { set -a; . ~/.config/workflow-os/cf.env; set +a; }
PY=""
for c in python3 python py; do
  if command -v "$c" >/dev/null 2>&1 && [ "$("$c" -c 'print(12345)' 2>/dev/null)" = "12345" ]; then PY="$c"; break; fi
done
[ -z "$PY" ] && { echo "⛔ 找不到可以執行的 Python，客戶名檢查沒有跑，不准部署"; exit 2; }
PYTHONIOENCODING=utf-8 "$PY" scripts/check_no_client_names.py "$@"

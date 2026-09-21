#!/bin/bash
# 部署前一定要跑這支。目前只有一道關：客戶名稱不得出現在對外網站。
#
# 2026-09-21 建。那天對外職缺頁把客戶簡稱印在卡片上，同一次掃描還找到
# 4 個公開可讀、整頁都是客戶名的內部頁面。Jacky 問「為什麼一直在修單點
# 事件」——因為從來沒有任何程式在送出去之前檢查過。這支就是那道檢查。
set -e
cd "$(dirname "$0")/.."
set -a; . ~/.config/workflow-os/cf.env; set +a
python3 scripts/check_no_client_names.py "$@"

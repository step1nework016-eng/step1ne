#!/bin/bash
# 把 /apply-beta/（新版應徵表單：履歷三條路＋錯誤訊息貼按鈕旁＋選填區收合）換成正式的 /apply/。
#
# 2026-10-12 建。Jacky 先用手機測 https://step1ne.com/apply-beta/ ，說可以才跑這支：
#     bash scripts/swap_apply_beta.sh
#
# 做的事：舊版先複製一份到 /tmp（不放進網站資料夾，免得被部署出去）→ 新版蓋過去
# → 自檢＋客戶名檢查 → commit → 推上線。
# 同一份檔案在兩個網址都能用（頁面自己判斷是不是 /apply-beta/，測驗做完跳回對的那一頁）。
# 要退回舊版：git revert 這次的 commit 再推一次就好。
set -e
cd "$(dirname "$0")/.."
[ -f apply-beta/index.html ] || { echo "⛔ 找不到 apply-beta/index.html"; exit 1; }
grep -q 'resume-step.js' apply-beta/index.html || { echo "⛔ apply-beta 不是新版（沒有履歷三條路）"; exit 1; }
cp apply/index.html "/tmp/apply_index_before_swap_$(date +%Y%m%d%H%M).html"
cp apply-beta/index.html apply/index.html
python3 scripts/check_pages.py
bash scripts/predeploy.sh
git add apply/index.html
git commit -m "應徵表單新版上正式站：/apply-beta/ → /apply/（履歷三條路、錯誤訊息貼按鈕旁、選填收合、三步說明）

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push deploy HEAD:main
echo "✅ 已推上線，約 1 分鐘後生效：https://step1ne.com/apply/"

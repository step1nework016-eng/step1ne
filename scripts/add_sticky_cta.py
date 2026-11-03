#!/usr/bin/env python3
"""文章頁底部常駐「LINE 洽詢／看目前職缺」按鈕（2026-11-03 Jacky 核准，樣式跟職缺頁一致）。
每篇 articles/<slug>/index.html 沒有就補上；已經有的跳過（可重複跑）。ship.sh 上線前會自動跑，新文章不會漏。
職缺頁本來就有自己的底部常駐列，這支不碰 jobs/。"""
import glob, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
snip = open(os.path.join(ROOT, 'scripts', '_sticky_cta.html'), encoding='utf-8').read()
snip = snip.replace('{{PRIMARY_HREF}}', '/jobs/').replace('{{PRIMARY_EVT}}', 'jobs_cta_click').replace('{{PRIMARY_TEXT}}', '看目前職缺')
n = 0
for f in sorted(glob.glob(os.path.join(ROOT, 'articles', '*', 'index.html'))):
    s = open(f, encoding='utf-8').read()
    if 's1ne-sticky-cta' in s or '</body>' not in s:
        continue
    open(f, 'w', encoding='utf-8').write(s.replace('</body>', snip + '\n</body>', 1))
    n += 1
print(f'✅ 文章底部按鈕：新補 {n} 篇' if n else '文章底部按鈕：都已經有了')

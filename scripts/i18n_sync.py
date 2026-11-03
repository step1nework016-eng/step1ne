# -*- coding: utf-8 -*-
"""推上線前呼叫：中文頁改了，日文／英文版跟著重產（缺的段落自動翻）。

publish_job.py、close_sync.py、ship.sh 推之前都呼叫這支，日英版才不會停在舊內容。
失敗不擋中文上線（中文頁才是主體），但會印出警告，下一次任何人上線時會再補。
用法：python3 scripts/i18n_sync.py   （從專案根目錄；或 from i18n_sync import sync）
"""
import os, subprocess, sys

SITE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


def sync(log=print):
    r = subprocess.run([sys.executable, os.path.join(SITE, 'scripts', 'i18n_site.py'), '--auto'],
                       cwd=SITE, capture_output=True, text=True, timeout=1800)
    out = (r.stdout or '') + (r.stderr or '')
    if r.returncode == 0:
        log('✅ 日文／英文版已同步')
        return True
    log('⚠️ 日文／英文版沒有同步成功（中文照常上線，下次上線會再補）：' + out.strip()[-400:])
    return False


if __name__ == '__main__':
    sys.exit(0 if sync() else 1)

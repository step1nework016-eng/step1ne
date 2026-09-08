#!/usr/bin/env python3
"""交件前自檢：把今天靠 Jacky 抓出來的那幾類錯誤變成自動檢查。

2026-09-08 建立。當天交件後被逐一指出的低級錯誤：
  ・列表頁薪資改成「N 萬起」了，內頁還留著「40,833–50,167」區間
  ・手機底部應徵列把整段薪資說明塞進去，斷成四行、按鈕佔掉大半條
  ・文章內頁的漢堡按鈕是死的（沒有選單容器、也沒有點擊行為）
  ・頁首同時出現兩個站名
共同原因：**我沒有在交件前自己把每一頁每個按鈕點過一遍。**

這支只做靜態檢查，抓的是「一定錯」的那種（規則不一致、連結指向不存在
的頁面、按鈕沒接東西）。版面擠不擠還是要真的用手機寬度看，但那些
一眼就看得出來，靠人看沒問題——會漏的是這種散在五個檔案裡的不一致。
"""
import io
import os
import re
import sys

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
issues = []


def bad(f, msg):
    issues.append((f, msg))


def check_salary(f, h):
    """月薪一律「N 萬起」，只有年薪才寫區間（2026-09-07 Jacky 拍板）。"""
    for m in re.finditer(r'月薪[^<。，]{0,4}([\d,]{4,})\s*[–~-]\s*([\d,]{4,})', h):
        bad(f, f'月薪還寫成區間：{m.group(0)[:32]}')
    for m in re.finditer(r'>([\d.]+)萬\s*[–-]\s*([\d.]+)萬<', h):
        bad(f, f'薪資尺還畫區間：{m.group(0)[:26]}')


def check_burger(f, h):
    """漢堡按鈕一定要真的能開東西。"""
    if 'hd-burger' not in h:
        return
    has_menu = 'id="mnav"' in h
    has_click = bool(re.search(r'<button[^>]*hd-burger[^>]*onclick=', h, re.S)) \
        or 'hd-burger' in h and re.search(r"querySelector\(['\"]\.hd-burger", h)
    if not has_menu:
        bad(f, '有漢堡按鈕但沒有選單容器（#mnav）——按了不會有反應')
    if not has_click:
        bad(f, '漢堡按鈕沒有接任何點擊行為')


def check_header(f, h):
    """頁首只該有一個站名。"""
    m = re.search(r'<a class="hd-logo".*?</a>', h, re.S)
    if not m:
        return
    names = re.findall(r'<b>([^<]+)</b>', m.group(0))
    if len(names) > 1:
        bad(f, f'頁首有多個站名：{names}')
    for n in names:
        if n != 'Step1ne':
            bad(f, f'頁首站名不是 Step1ne：{n}')


def check_headings(f, h):
    """標題被複製一份、或開合標籤數量不符。

    2026-09-08：職缺內頁 4 個區塊都是 <h2>應徵條件</h2>應徵條件</h2>，
    畫面上標題底下又出現一次同樣的字。產頁面時模板拼錯，看 HTML 不容易
    發現，但使用者一眼就看到。
    """
    for m in re.finditer(r'<h([1-6])>([^<]+)</h\1>\2</h\1>', h):
        bad(f, f'標題重複一次：{m.group(2)[:20]}')
    for lv in '123456':
        o = len(re.findall(f'<h{lv}[ >]', h))
        c = len(re.findall(f'</h{lv}>', h))
        if o != c:
            bad(f, f'h{lv} 標籤數量不符：開 {o} 個、關 {c} 個')


def check_internal_notes(f, h):
    """給我們自己看的備註不能留在公開頁面。

    2026-09-08：新版上線後，職缺列表與獵才專欄各留著一段開頭寫
    「這一塊是給你看的，不是給求職者看的」的資料品質備註，直接公開在線上，
    而且內容還過期（說還有 6 筆暫存網址、BIM 疑似重複頁）。
    """
    for kw in ('給你看的', '不是給求職者', '不是給讀者', '設計稿說明', 'TODO', 'FIXME'):
        if kw in h:
            bad(f, f'公開頁面留著內部備註：{kw}')


def check_links(f, h, slugs, redirects):
    """站內職缺連結必須指向真的存在的頁面（或有 301）。"""
    for m in re.finditer(r'href="/jobs/([a-z0-9_\-]+)/"', h):
        s = m.group(1)
        if s not in slugs and s not in redirects:
            bad(f, f'連到不存在的職缺頁：/jobs/{s}/')


def check_assets(f, h):
    """子目錄底下用相對路徑會 404（2026-09-07 線上破圖過）。"""
    for m in re.finditer(r'(?:src|href)="(assets/[^"]+)"', h):
        bad(f, f'資源用相對路徑，子目錄會 404：{m.group(1)}')


def check_counts(f, h):
    """列表頁寫死的數字要跟實際列數一致。"""
    rows = h.count('<a class="row"')
    if not rows:
        return
    for m in re.finditer(r'共 <b>(\d+)</b> 個職缺', h):
        if int(m.group(1)) != rows:
            bad(f, f'頁面寫「共 {m.group(1)} 個職缺」，實際只有 {rows} 列')
    for m in re.finditer(r'地區不限（(\d+) 個職缺）', h):
        if int(m.group(1)) != rows:
            bad(f, f'地區下拉寫「{m.group(1)} 個職缺」，實際只有 {rows} 列')
    # 尺規刻度必須遞增
    for m in re.finditer(r'<div class="ticks">(.*?)</div>', h, re.S):
        v = [float(x) for x in re.findall(r'>([\d.]+)萬</span>', m.group(1))]
        if v and any(v[i] > v[i + 1] for i in range(len(v) - 1)):
            bad(f, f'薪資尺刻度沒有由小到大：{v}')


def main():
    jobs_dir = os.path.join(SITE, 'jobs')
    slugs = {d for d in os.listdir(jobs_dir) if os.path.isdir(os.path.join(jobs_dir, d))}
    redirects = set()
    rp = os.path.join(SITE, '_redirects')
    if os.path.isfile(rp):
        for line in io.open(rp, encoding='utf-8'):
            m = re.match(r'\s*/jobs/([^/\s]+)/?\s', line)
            if m:
                redirects.add(m.group(1))

    targets = sys.argv[1:] or [f for f in os.listdir(SITE) if f.startswith('redesign-') and f.endswith('.html')]
    for f in sorted(targets):
        p = f if os.path.isabs(f) else os.path.join(SITE, f)
        h = io.open(p, encoding='utf-8').read()
        n = os.path.basename(p)
        check_salary(n, h)
        check_burger(n, h)
        check_header(n, h)
        check_headings(n, h)
        check_internal_notes(n, h)
        check_links(n, h, slugs, redirects)
        check_assets(n, h)
        check_counts(n, h)

    if not issues:
        print(f'✅ {len(targets)} 個頁面全部通過')
        return 0
    cur = None
    for f, msg in issues:
        if f != cur:
            print(f'\n── {f}')
            cur = f
        print(f'   ❌ {msg}')
    print(f'\n共 {len(issues)} 個問題')
    return 1


if __name__ == '__main__':
    sys.exit(main())

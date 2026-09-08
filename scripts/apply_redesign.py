#!/usr/bin/env python3
"""把新版設計稿套上線，但保留線上頁面的 SEO 與追蹤設定。

2026-09-08 建立。新版是「設計稿」——head 幾乎是空的：沒有 meta description、
沒有 canonical、沒有 og:image、沒有 JSON-LD、也沒有 GA 追蹤碼。
直接複製上去等於：社群分享沒有預覽圖、Google 少掉結構化資料、流量統計斷掉。

所以做法是**保留線上那份 head 的必要元素，只換掉版面**，而不是整份覆蓋。

⚠️ H1 有改的頁面（首頁、職缺列表）等於同時動了版面與標題，之後成效變化
   會分不清是哪一個造成的。上線前先存了 GSC 基準：
   docs/gsc-baseline-新版上線前-2026-09-08.json
"""
import io
import os
import re
import sys

SITE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# 這些是「就算改版也一定要跟著搬過去」的東西
KEEP = [
    r'<title>.*?</title>',
    r'<meta name="description"[^>]*>',
    r'<meta name="keywords"[^>]*>',
    r'<link rel="canonical"[^>]*>',
    r'<meta property="og:[^>]*>',
    r'<meta name="twitter:[^>]*>',
    r'<script[^>]*application/ld\+json[^>]*>.*?</script>',
    r'<script[^>]*googletagmanager[^>]*>.*?</script>',
    r'<script>[^<]*gtag\([^<]*</script>',
    r'<link rel="icon"[^>]*>',
    r'<link[^>]*apple-touch-icon[^>]*>',
]

PAIRS = [
    ('index.html', 'redesign-home.html'),
    ('jobs/index.html', 'redesign-jobs.html'),
    ('articles/index.html', 'redesign-articles.html'),
]


def head_of(h):
    m = re.search(r'<head[^>]*>(.*?)</head>', h, re.S)
    return m.group(1) if m else h[:4000]


def port(live_html, new_html):
    """把線上 head 的必要元素搬進新版，回傳 (新內容, 搬了幾項)。"""
    lh = head_of(live_html)
    keep = []
    for pat in KEEP:
        keep += [m.group(0) for m in re.finditer(pat, lh, re.S)]

    out = new_html
    # 新版自己的 title 是「［新版設計稿］…」，一定要換掉
    out = re.sub(r'<title>.*?</title>', '', out, flags=re.S)
    # 新版若已有同名 meta（例如 viewport 以外的），先不動；只補線上有而新版沒有的
    add = [k for k in keep if k.split('>')[0][:60] not in out]
    m = re.search(r'</head>', out)
    if not m:
        raise RuntimeError('新版沒有 </head>，無法安全套用')
    out = out[:m.start()] + '\n' + '\n'.join(add) + '\n' + out[m.start():]
    return out, len(add)


def rich_footer(new_html, donor_html):
    """職缺列表與專欄列表的頁尾只有一行地址，沒有任何連結。

    2026-09-08 比對發現：套上去會讓 /about/、/articles/、/construction/
    這些頁面從職缺列表少掉一條內部連結。首頁那份頁尾本來就有完整連結，
    直接沿用同一份，順便三頁的頁尾也統一了。
    """
    m = re.search(r'<footer.*?</footer>', new_html, re.S)
    d = re.search(r'<footer.*?</footer>', donor_html, re.S)
    if not m or not d:
        return new_html, False
    if len(re.findall(r'href="/[^"#?]*"', m.group(0))) >= 2:
        return new_html, False       # 本來就有連結就不動
    return new_html[:m.start()] + d.group(0) + new_html[m.end():], True


def main():
    dry = '--apply' not in sys.argv
    for live_p, new_p in PAIRS:
        live = io.open(os.path.join(SITE, live_p), encoding='utf-8').read()
        new = io.open(os.path.join(SITE, new_p), encoding='utf-8').read()
        merged, n = port(live, new)
        if new_p != 'redesign-home.html':
            donor = io.open(os.path.join(SITE, 'redesign-home.html'), encoding='utf-8').read()
            merged, swapped = rich_footer(merged, donor)
            if swapped:
                print(f'{"":<22} 頁尾換成首頁那份（原本沒有任何連結）')
        title = re.search(r'<title>(.*?)</title>', merged, re.S)
        print(f'{live_p:<22} 補回 {n} 項　標題→{(title.group(1).strip()[:40] if title else "❌ 沒有標題")}')
        for label, pat in [('meta desc', r'name="description"'), ('canonical', r'rel="canonical"'),
                           ('og:image', r'property="og:image"'), ('JSON-LD', r'application/ld\+json'),
                           ('GA', r'gtag|googletagmanager')]:
            print(f'      {label:<10}{"✓" if re.search(pat, merged) else "✗"}')
        if not dry:
            io.open(os.path.join(SITE, live_p), 'w', encoding='utf-8').write(merged)
    print('\n（預覽模式，加 --apply 才會真的寫入）' if dry else '\n已寫入')


if __name__ == '__main__':
    main()

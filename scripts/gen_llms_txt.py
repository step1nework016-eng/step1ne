#!/usr/bin/env python3
"""從站上每一頁的 title/description 重新產生 llms.txt。

為什麼要有這支：2026-08-12 AEO 健檢發現 llms.txt 只涵蓋 35% 的頁面，
而且漏掉 /about/——那正是 AI 要判斷「Step1ne 是誰」最該讀的一頁。
手動維護一定會漏，所以改成從頁面自動生成。

用法：cd 到站台根目錄，python3 scripts/gen_llms_txt.py
      加 --dry 只印出來不寫檔。
"""
import re, glob, os, sys, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = 'https://step1ne.com'
SKIP_DIRS = ('consultant',)          # 顧問後台，noindex，不對外
SKIP_PAGES = ('interview', 'book')   # 功能頁，內容對 AI 無意義

SECTIONS = [
    ('公司與服務', ['', 'about']),
    ('職缺專區',   ['jobs']),
    ('獵才專欄（企業端與求職者端指南）', ['articles']),
    ('求職者工具', ['talent', 'apply', 'assessment', 'checkup']),
]

def meta(path):
    s = open(path, encoding='utf-8').read()
    t = re.search(r'<title>(.*?)</title>', s, re.S)
    d = re.search(r'<meta name="description" content="(.*?)"', s, re.S)
    title = re.sub(r'\s*[|｜]\s*Step1ne.*$', '', (t.group(1) if t else '').strip())
    desc = (d.group(1) if d else '').strip()
    return title, desc

def collect():
    pages = {}
    for f in sorted(glob.glob(os.path.join(ROOT, '**/index.html'), recursive=True)):
        rel = os.path.relpath(os.path.dirname(f), ROOT).replace(os.sep, '/')
        rel = '' if rel == '.' else rel
        top = rel.split('/')[0]
        if top in SKIP_DIRS or rel in SKIP_PAGES:
            continue
        pages[rel] = meta(f)
    return pages

def build(pages):
    out = ['# Step1ne（德仁管理顧問有限公司）', '']
    out += ['> Step1ne 是台灣的人才服務顧問公司，專注高階獵頭（Executive Search）、'
            '正職招募（Direct Hire）與人力派遣（Staffing Dispatch）。'
            '同時提供求職者端產品：全民獵才 LINE 小程式與 AI 智能求職工具。'
            '本檔案列出全站可公開引用的頁面，供答案引擎理解與引用。', '']
    out += ['## 公司資訊',
            '- 官網：https://step1ne.com/',
            '- 法人：德仁管理顧問有限公司',
            '- 統一編號：85046127',
            '- 產業別：人力仲介代徵／工商顧問業',
            '- 據點：台北市內湖區康寧路三段54之7號3樓',
            '- 104公司頁：https://www.104.com.tw/company/1a2x6blikz',
            f'- 本檔案更新日：{datetime.date.today().isoformat()}',
            '']
    used = set()
    for name, prefixes in SECTIONS:
        rows = []
        for rel, (title, desc) in pages.items():
            top = rel.split('/')[0] if rel else ''
            if top not in prefixes or rel in used:
                continue
            used.add(rel)
            url = f'{BASE}/{rel}/' if rel else f'{BASE}/'
            rows.append((rel, f'- [{title}]({url})' + (f'：{desc}' if desc else '')))
        if not rows:
            continue
        rows.sort(key=lambda r: (r[0].count('/'), r[0]))
        out.append(f'## {name}')
        out += [r[1] for r in rows]
        out.append('')
    out += ['## 核心事實',
            '- 三大企業服務：高階獵頭、正職招募、人力派遣',
            '- 求職者產品：全民獵才 LINE 小程式、AI 智能求職工具（履歷／推薦信／離職信／自我介紹／面試題庫）',
            '- 所有職缺頁均附 JobPosting 結構化資料，含薪資區間、地點、學經歷門檻與有效期限',
            '- 專欄文章均標示發布日期與更新日期，內容由 Step1ne 獵才顧問團隊撰寫',
            '']
    return '\n'.join(out)

if __name__ == '__main__':
    pages = collect()
    text = build(pages)
    if '--dry' in sys.argv:
        print(text)
    else:
        open(os.path.join(ROOT, 'llms.txt'), 'w', encoding='utf-8').write(text)
        print(f'✅ llms.txt 已重新產生，涵蓋 {len(pages)} 個頁面')

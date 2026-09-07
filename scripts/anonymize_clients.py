#!/usr/bin/env python3
"""把對外頁面的委任客戶名稱換成匿名描述。

2026-09-07 Jacky 指示：客戶名只有內部看得到，對外網站一律不能出現。
`consultant/` 底下是顧問後台（robots.txt 已 Disallow），維持原樣不處理。

替代詞沿用站上既有的匿名寫法（例如「上市上櫃遊戲集團」原本就在用）。
順序由長到短，避免長名被短名先切掉。
"""
import re,io,glob,sys

RULES=[
 # 美德醫療（高階獵頭・保密委任）
 ('美德醫療（美德相邦集團）','跨國醫療用品製造集團'),
 ('美德醫療集團管理總部','集團管理總部'),
 ('美德醫療集團','跨國醫療用品製造集團'),
 ('美德相邦集團','跨國醫療用品製造集團'),
 ('美德醫療','跨國醫療用品製造集團'),
 ('美德相邦','跨國醫療用品製造集團'),
 # 律准科技（營建工程）
 ('律准專注於','用人企業專注於'),
 ('律准科技深耕','用人企業深耕'),
 ('律准科技招募','用人企業招募'),
 ('律准科技','高科技廠房工程公司'),
 ('律准','用人企業'),
 # 遊戲橘子（派遣要派公司）
 ('遊戲橘子集團（上市遊戲產業集團）','上市上櫃遊戲集團'),
 ('遊戲橘子集團','上市上櫃遊戲集團'),
 ('遊戲橘子','上市上櫃遊戲集團'),
 # 海德生貿易 / Indian Motorcycle
 ('Indian Motorcycle 美國印地安機車台灣總代理','美式重機品牌台灣總代理'),
 ('Indian Motorcycle 台灣總代理','美式重機品牌台灣總代理'),
 ('Indian Motorcycle','美式重機品牌'),
 ('美國印地安機車','美式重機'),
 ('海德生貿易','進口重機代理商'),
 ('海德生','進口重機代理商'),
]
TARGETS=sorted(glob.glob('jobs/*/index.html'))+['jobs/index.html','llms.txt','redesign-jobs.html']
changed=[]
for f in TARGETS:
    try: s=io.open(f,encoding='utf-8').read()
    except FileNotFoundError: continue
    o=s; hits={}
    for a,b in RULES:
        n=s.count(a)
        if n: hits[a]=n; s=s.replace(a,b)
    if s!=o:
        io.open(f,'w',encoding='utf-8').write(s)
        changed.append((f,hits))
print(f"處理 {len(changed)} 個檔案\n")
for f,h in changed:
    print(f"  {f}")
    for a,n in h.items(): print(f"      {a} × {n}")

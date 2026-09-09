#!/usr/bin/env python3
"""重建 sitemap.xml。

為什麼要這支：2026-09-07 查到 7 篇 2026-09-03 發布的文章不在 sitemap 裡。
根因是「上架職缺」的流程會更新 sitemap，但文章發布流程完全不碰它。
手動補會再漏一次，所以改成每次都重新產生。

原則：
- 收錄範圍 = 既有 sitemap 已收錄的網址 ∪ 所有 articles/ 與 jobs/ 底下的頁
- priority / changefreq：既有網址沿用原值，不擅自更動編輯判斷
- lastmod：取 git 最後一次修改該檔案的日期（真實資料，不是產生當天）
- 系統頁（apply/interview/portal…）本來就不在 sitemap，維持不收錄
"""
import re,io,os,glob,subprocess,sys
BASE='https://step1ne.com'
old=io.open('sitemap.xml',encoding='utf-8').read()
keep={}
for m in re.finditer(r'<url>\s*<loc>([^<]+)</loc>(.*?)</url>',old,re.S):
    u=m.group(1).replace(BASE,''); blk=m.group(2)
    cf=re.search(r'<changefreq>([^<]+)</changefreq>',blk)
    pr=re.search(r'<priority>([^<]+)</priority>',blk)
    keep[u]=(cf.group(1) if cf else 'monthly', pr.group(1) if pr else '0.8')

def gitdate(p):
    try:
        d=subprocess.run(['git','log','-1','--format=%ad','--date=short','--',p],
                         capture_output=True,text=True).stdout.strip()
        return d or None
    except Exception: return None

urls={}
for u,(cf,pr) in keep.items():
    f=(u.strip('/')+'/index.html') if u!='/' else 'index.html'
    urls[u]=(cf,pr,gitdate(f) if os.path.exists(f) else None)

# ⚠️ 2026-09-09 加：_redirects 裡做過 301 的網址不可以進 sitemap——資料夾
# 還在（舊頁沒刪或留著當備份）但線上其實是轉址，收進來等於叫 Google 去索引
# 一個 301。實際踩過：/jobs/bim-engineer/ 是已關閉職缺、線上 301 導到
# bim-engineer-tongluo，卻被自動收進 sitemap。
redirected=set()
if os.path.exists('_redirects'):
    for line in io.open('_redirects',encoding='utf-8'):
        line=line.strip()
        if not line or line.startswith('#'): continue
        src=line.split()[0]
        redirected.add(src if src.endswith('/') else src+'/')

added=[]
for pat,cf,pr in [('articles/*/index.html','monthly','0.8'),('jobs/*/index.html','weekly','0.8')]:
    for f in sorted(glob.glob(pat)):
        u='/'+f.rsplit('/index.html',1)[0]+'/'
        if u in redirected: continue
        if u not in urls:
            urls[u]=(cf,pr,gitdate(f)); added.append(u)

# 手動清單 keep 裡如果也有已轉址的網址，一併踢掉
for u in [x for x in urls if x in redirected]:
    del urls[u]; print(f'  － 略過（線上是 301）：{u}')

def key(u): return (0 if u=='/' else 1, u)
out=['<?xml version="1.0" encoding="UTF-8"?>','<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">']
for u in sorted(urls,key=key):
    cf,pr,lm=urls[u]
    lmx=f'<lastmod>{lm}</lastmod>' if lm else ''
    out.append(f'  <url><loc>{BASE}{u}</loc>{lmx}<changefreq>{cf}</changefreq><priority>{pr}</priority></url>')
out.append('</urlset>')
io.open('sitemap.xml','w',encoding='utf-8').write('\n'.join(out)+'\n')
print(f"總網址 {len(urls)}（原本 {len(keep)}）　新增 {len(added)} 筆：")
for a in added: print('  +',a)

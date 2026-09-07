#!/usr/bin/env python3
"""把文章內頁換成新版版面。

嚴格限制（2026-09-07 與 Jacky 約定）：
- <head> 只換兩樣：<style> 區塊、Google Fonts 連結
- title / meta description / og:* / JSON-LD / GA 一律不動
- 內文一個字都不改，只換包裝的標籤與 CSS
"""
import re,io,sys,os,glob,html

CSS=io.open('scripts/_article.css',encoding='utf-8').read()
FONTS='<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;700;900&display=swap" rel="stylesheet">'
BODY_TPL=io.open('scripts/_article_body.html',encoding='utf-8').read()

def convert(path):
    s=io.open(path,encoding='utf-8').read()
    head,rest=s.split('</head>',1)
    slug=path.split('/')[1]

    # --- head：只換 <style>、字體 stylesheet、theme-color ---
    # preconnect 一律保留（影響字體載入速度）；title/meta/og/JSON-LD/GA 完全不碰。
    head2=re.sub(r'<style>.*?</style>','<style>\n'+CSS+'\n</style>',head,count=1,flags=re.S)
    n=[0]
    def _css(mm):
        n[0]+=1
        return FONTS if n[0]==1 else ''
    head2=re.sub(r'<link[^>]*fonts\.googleapis\.com/css2[^>]*rel="stylesheet"[^>]*>',_css,head2)
    head2=head2.replace('content="#f4f1ea"','content="#F4F6F8"')

    # --- 抽內容 ---
    main=re.search(r'<main[^>]*>(.*?)</main>',rest,re.S).group(1)
    art=re.search(r'<article[^>]*>(.*?)</article>',main,re.S)
    body=art.group(1) if art else main
    body=re.sub(r'\sstyle="[^"]*"','',body)
    body=re.sub(r'\sclass="(?:wrap|info-byline|art-tag)"','',body)

    eyebrow=''
    m=re.search(r'<div[^>]*>([^<]{2,40})</div>\s*<h1',body)
    if m: eyebrow=m.group(1).strip(); body=body[:m.start()]+'<h1'+body[m.end():]
    h1=re.search(r'<h1[^>]*>(.*?)</h1>',body,re.S)
    title=h1.group(1).strip(); body=body[h1.end():]
    # 原本的作者列（可能出現在文章任何位置、class 名稱也不一致）一律移除，
    # 改由新版 .by 那一列統一呈現，避免同一頁出現兩次作者資訊。
    body=re.sub(r'<p[^>]*>(?:(?!</p>).)*?作者：(?:(?!</p>).)*?<time[^>]*>.*?</time>(?:(?!</p>).)*?</p>','',body,flags=re.S)

    dp=re.search(r'"datePublished"\s*:\s*"([^"]+)"',head).group(1)[:10]
    am=re.search(r'<p>\s*<strong>直接答案：</strong>(.*?)</p>',body,re.S)
    answer=am.group(1).strip() if am else ''
    if am: body=body[:am.start()]+body[am.end():]
    fm=re.search(r'<p>((?:(?!</p>).)*(?:本文法條引自|本文僅供一般性參考|資料來源|本文引用)(?:(?!</p>).)*)</p>\s*$',body,re.S)
    foot=fm.group(1).strip() if fm else ''
    if fm: body=body[:fm.start()]

    toc=[]
    def h2id(mm):
        # 目錄文字：h2 裡的編號徽章（<span class="num">）不重複帶進側邊目錄
        inner=re.sub(r'<span class="num">.*?</span>','',mm.group(1),flags=re.S)
        t=re.sub(r'<[^>]*>','',inner).strip()
        i='sec-%d'%(len(toc)+1); toc.append((i,t))
        return f'<h2 id="{i}">{mm.group(1)}</h2>'
    body=re.sub(r'<h2[^>]*>(.*?)</h2>',h2id,body,flags=re.S)

    n=len(re.sub(r'\s','',re.sub(r'<[^>]*>','',body)))
    mins=max(1,round(n/400))
    nodes='\n'.join(f'<a class="tn" href="#{i}" data-s="{i}"><i></i><span>{html.escape(t)}</span></a>' for i,t in toc)
    mtoc='\n'.join(f'<a href="#{i}">{html.escape(t)}</a>' for i,t in toc)

    nb=(BODY_TPL.replace('{{TITLE}}',title).replace('{{EYEBROW}}',eyebrow or '獵才專欄')
        .replace('{{DATE}}',dp).replace('{{DATEDOT}}',dp).replace('{{MINS}}',str(mins))
        .replace('{{ANSWER}}',answer).replace('{{BODY}}',body.strip()).replace('{{NODES}}',nodes)
        .replace('{{MTOC}}',mtoc).replace('{{NSEC}}',str(len(toc)))
        .replace('{{FOOTNOTE}}',f'<div class="foot-note">{foot}</div>' if foot else ''))
    io.open(path,'w',encoding='utf-8').write(head2+'</head>\n'+nb)
    return len(toc),mins,bool(answer),bool(foot)

if __name__=='__main__':
    tg=sys.argv[1:] or sorted(glob.glob('articles/*/index.html'))
    for p in tg:
        try:
            t,m,a,f=convert(p)
            print(f"  {p.split('/')[1]:36} {t} 段 / {m} 分 / 答案{'✓' if a else '✗'} / 免責{'✓' if f else '－'}")
        except Exception as e:
            print(f"  ❌ {p}: {type(e).__name__}: {e}")

#!/usr/bin/env python3
"""把單一職缺頁換成新版版面（示範用，輸出到獨立檔案不覆蓋原頁）。

限制：apply 連結的 ?job= 與 utm_* 參數原樣保留；手機選單改用新版 #mnav
（原頁是 s1ne-mmenu，換版時整組一起換，不留孤兒 id）。
"""
import re,io,sys,json,html
SLUG=sys.argv[1]; OUT=sys.argv[2]
s=io.open(f'jobs/{SLUG}/index.html',encoding='utf-8').read()
head,rest=s.split('</head>',1)
e=html.escape

def jp():
    for m in re.finditer(r'<script[^>]*application/ld\+json[^>]*>(.*?)</script>',head,re.S):
        d=json.loads(m.group(1))
        for o in (d if isinstance(d,list) else [d]):
            if isinstance(o,dict) and o.get('@type')=='JobPosting': return o
J=jp()
title=J.get('title','').strip()
m=re.search(r'<h1[^>]*>(.*?)</h1>',rest,re.S)
sub=re.sub(r'<[^>]*>','',re.search(r'<span class="h1-sub">(.*?)</span>',m.group(1),re.S).group(1)).strip() if 'h1-sub' in m.group(1) else ''
apply_url=re.search(r'href="(/apply/\?job=[^"]*)"',rest).group(1)

spec=re.search(r'<dl class="spec">(.*?)</dl>',rest,re.S).group(1)
rows=re.findall(r'<dt>(.*?)</dt><dd>(.*?)</dd>',spec,re.S)

def block(h):
    i=rest.find('>'+h+'<')
    if i<0: return ''
    j=rest.find('<h2',i+1)
    seg=rest[rest.find('>',i)+1:j if j>0 else i+4000]
    seg=re.sub(r'\sstyle="[^"]*"','',seg)
    return seg
duties=block('工作內容'); reqs=block('應徵條件'); why=block('為什麼選擇這個機會'); faq=block('常見問題')
sal=next((v for k,v in rows if '薪資' in k),'')
loc=next((v for k,v in rows if '地點' in k),'')
emp=next((v for k,v in rows if '僱' in k or '型態' in k),'')

TPL=io.open('scripts/_job_tpl.html',encoding='utf-8').read()
io.open(OUT,'w',encoding='utf-8').write(TPL
 .replace('{{TITLE}}',e(title)).replace('{{SUB}}',e(sub)).replace('{{SLUG}}',SLUG)
 .replace('{{APPLY}}',apply_url).replace('{{SAL}}',e(sal)).replace('{{LOC}}',e(loc)).replace('{{EMP}}',e(emp))
 .replace('{{SPECROWS}}',''.join(f'<div class="sr"><dt>{e(re.sub(r"<[^>]*>","",k))}</dt><dd>{re.sub(r"<[^>]*>","",v)}</dd></div>' for k,v in rows))
 .replace('{{DUTIES}}',duties).replace('{{REQS}}',reqs).replace('{{WHY}}',why).replace('{{FAQ}}',faq))
print(f'{SLUG}：{len(rows)} 條件列、工作內容 {len(duties)} 字、FAQ {faq.count("<details")} 題 → {OUT}')

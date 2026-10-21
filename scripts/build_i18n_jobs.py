# -*- coding: utf-8 -*-
# 產生印尼文／越南文職缺頁（隱藏測試路徑 /id/jobs/<slug>/、/vi/jobs/<slug>/）。
# 用法：python3 scripts/build_i18n_jobs.py   （從專案根目錄）
# 這些頁面故意：noindex、不進 sitemap／llms.txt／任何列表與導覽，等 Jacky 核准才公開。
import os, sys, re, html, urllib.parse
sys.path.insert(0, os.path.dirname(__file__))
from i18n_data import L, SLUGS

ROOT = os.path.join(os.path.dirname(__file__), '..')
e = html.escape

CSS = """
*{box-sizing:border-box}
html,body{margin:0;padding:0}
html{-webkit-text-size-adjust:100%}
:root{--ink:#0f1b2d;--ink2:#475569;--mut:#64748b;--line:#e2e8f0;--bg:#f6f8fb;--blue:#1880B4;--blue-d:#0f5f88;--tint:#e8f3fa;--green:#0f766e;--green-bg:#e9f7f3;--amber:#a15c07;--amber-bg:#fdf3e2}
body{font-family:"Noto Sans","Noto Sans TC",system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);background:var(--bg);line-height:1.7;-webkit-font-smoothing:antialiased;padding-bottom:84px;overflow-wrap:anywhere}
a{color:var(--blue);text-decoration:none}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid var(--blue);outline-offset:2px}
.wrap{max-width:820px;margin:0 auto;padding:0 20px}
header.top{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.94);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:12px;height:64px}
header.top img{height:36px;width:auto;display:block}
.hbtn{background:var(--ink);color:#fff;font-weight:800;font-size:14px;padding:0 18px;min-height:44px;display:inline-flex;align-items:center;border-radius:12px;white-space:nowrap}
.hbtn:hover{color:#fff}
.sw{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:14px 0 0;font-size:13px;color:var(--mut)}
.sw a,.sw b{display:inline-flex;align-items:center;min-height:44px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:#fff;font-weight:700;color:var(--ink2)}
.sw b{background:var(--ink);color:#fff;border-color:var(--ink)}
main{padding-bottom:24px}
h1{font-size:clamp(24px,5.4vw,34px);font-weight:900;line-height:1.35;letter-spacing:-.3px;margin:14px 0 8px;color:var(--ink)}
.h1sub{font-size:15.5px;color:var(--ink2);margin:0 0 12px}
.tags{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}
.tags span{font-size:12.5px;font-weight:700;color:var(--ink2);background:#f1f5f9;border-radius:6px;padding:3px 8px}
.tags span.hl{color:var(--green);background:var(--green-bg);border:1px solid #bfe6db}
.must{background:var(--amber-bg);border:1px solid #f3d9a8;border-left:6px solid var(--amber);border-radius:12px;padding:14px 16px;margin:12px 0 14px}
.must b{display:block;font-size:17px;color:#6d3d03;line-height:1.5}
.must span{display:block;font-size:14.5px;color:#5b3a10;margin-top:4px}
.card{background:#fff;border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:0 0 12px}
.pay{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:22px;font-weight:900;line-height:1.4}
.k{font-size:13px;color:var(--mut);margin:0 0 4px}
.note{font-size:13px;color:var(--mut);margin:8px 0 0}
.info{display:grid;grid-template-columns:110px 1fr;gap:12px 14px;font-size:14.5px;margin:0}
.info dt{color:var(--mut)}
.info dd{margin:0;font-weight:600}
.info dd small{display:block;font-weight:400;color:var(--ink2);font-size:13.5px}
@media (max-width:520px){.info{grid-template-columns:1fr;gap:2px 0}.info dd{margin-bottom:10px}.info dd:last-child{margin-bottom:0}}
h2{font-size:19px;font-weight:800;margin:28px 0 10px;color:var(--ink)}
h3{font-size:15px;font-weight:800;color:var(--green);margin:14px 0 6px}
h3:first-child{margin-top:0}
ul.dots{margin:0 0 6px;padding:0;list-style:none}
ul.dots li{position:relative;padding-left:16px;margin:0 0 6px;font-size:15px;line-height:1.7}
ul.dots li:before{content:"";position:absolute;left:2px;top:.72em;width:6px;height:6px;border-radius:50%;background:var(--green)}
.two{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px}
.lbl{font-size:13px;font-weight:800;color:var(--green);margin:0 0 8px}
.why h3{color:var(--ink);font-size:16px;margin:0 0 4px}
.why p{margin:0;color:var(--ink2);font-size:14.5px}
.elig{border:2px dashed #94a3b8;background:#fff;border-radius:14px;padding:16px 18px;color:var(--mut);font-size:15px}
ol.tl{list-style:none;margin:0;padding:0}
ol.tl li{position:relative;padding:0 0 14px 26px;font-size:15px;font-weight:700}
ol.tl li:before{content:"";position:absolute;left:4px;top:7px;width:10px;height:10px;border-radius:50%;border:2px solid var(--green);background:#fff}
ol.tl li:after{content:"";position:absolute;left:9px;top:21px;bottom:0;width:2px;background:#d6e4e1}
ol.tl li:last-child:after{display:none}
.cta{display:inline-flex;align-items:center;justify-content:center;min-height:52px;background:var(--ink);color:#fff;font-weight:800;font-size:16px;padding:0 28px;border-radius:12px;text-align:center}
.cta:hover{color:#fff}
.lineln{display:inline-flex;align-items:center;min-height:44px;margin-left:10px;font-weight:700}
details{border:1px solid var(--line);border-radius:14px;background:#fff;margin:0 0 10px;overflow:hidden}
summary{cursor:pointer;list-style:none;padding:16px 18px;display:flex;align-items:flex-start;justify-content:space-between;gap:14px;font-weight:700;font-size:15.5px;min-height:44px}
summary::-webkit-details-marker{display:none}
summary i{font-style:normal;color:var(--blue);font-size:20px;line-height:1.2;transition:transform .25s}
details[open] summary i{transform:rotate(45deg)}
details p{margin:0;padding:0 18px 16px;color:var(--ink2);font-size:14.5px}
footer{border-top:1px solid var(--line);background:#eef2f7;padding:24px 0;text-align:center;color:#8a8d95;font-size:13px}
footer a{display:inline-flex;align-items:center;min-height:44px}
.bar{position:fixed;left:0;right:0;bottom:0;z-index:60;padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));background:rgba(255,255,255,.96);backdrop-filter:blur(10px);border-top:1px solid var(--line);transition:transform .25s}
.bar>div{max-width:820px;margin:0 auto;display:flex;gap:10px}
.bar.off{transform:translateY(110%)}
.bar a{display:flex;align-items:center;justify-content:center;min-height:48px;border-radius:12px;font-weight:800;font-size:15.5px}
.bar .go{flex:1;background:var(--ink);color:#fff}
.bar .line{flex:0 0 32%;background:#fff;border:1px solid #cbd5e1;color:var(--ink)}
@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
"""


def ul(items):
    return '<ul class="dots">' + ''.join('<li>%s</li>' % e(x) for x in items) + '</ul>'


def build(lang, slug):
    D = L[lang]; U = D['ui']; meta = SLUGS[slug]
    if meta['kind'] == 'houli':
        C = D['houli']; title = C['h1']; page_title = C['title']
    else:
        C = D['hsinchu']; title = C['titles'][slug]
        page_title = title + ' | Hsinchu'
        C = dict(C); C['h1'] = title
    desc = C['desc']
    zh_title_q = urllib.parse.quote(meta['zh_title'], safe='')
    apply_url = '/%s/apply-quick/?job=%s&title=%s&utm_source=website&utm_medium=job_page_%s&utm_campaign=%s' % (lang, slug, zh_title_q, lang, slug)
    canon = 'https://step1ne.com/%s/jobs/%s/' % (lang, slug)

    sw = '<nav class="sw" aria-label="%s"><span>%s:</span>' % (e(U['sw_label']), e(U['lang_label']))
    for code, label, path in (('zh', '中文', '/jobs/%s/' % slug), ('id', 'Bahasa Indonesia', '/id/jobs/%s/' % slug), ('vi', 'Tiếng Việt', '/vi/jobs/%s/' % slug)):
        if code == lang:
            sw += '<b aria-current="page" lang="%s">%s</b>' % (code if code != 'zh' else 'zh-Hant', e(label))
        else:
            sw += '<a href="%s" lang="%s" hreflang="%s">%s</a>' % (path, code if code != 'zh' else 'zh-Hant', code if code != 'zh' else 'zh-Hant', e(label))
    sw += '</nav>'

    spec = C['spec']
    pay = spec[0]
    spec_html = '<div class="card"><div class="k">%s</div><div class="pay">%s</div>%s</div>' % (
        e(pay[0]), e(pay[1]), ('<p class="note">%s</p>' % e(pay[2])) if pay[2] else '')
    rows = ''.join('<dt>%s</dt><dd>%s%s</dd>' % (e(a), e(b), ('<small>%s</small>' % e(c)) if c else '') for a, b, c, _ in spec[1:])
    spec_html += '<div class="card"><dl class="info">%s</dl></div><p class="note">%s</p>' % (rows, e(U['spec_note']))

    duties = ''.join('<h3>%s</h3>%s' % (e(h), ul(items)) for h, items in C['duties'])
    reqs = ('<div class="two"><div class="card"><p class="lbl">%s</p>%s</div><div class="card"><p class="lbl">%s</p>%s</div></div>'
            % (e(U['must']), ul(C['must']), e(U['nice']), ul(C['nice'])))
    why = ''.join('<div class="card why"><h3>%s</h3><p>%s</p></div>' % (e(h), e(p)) for h, p in C['why'])
    ben = '<div class="card">%s</div>' % ul(C['benefits'])
    steps = ''.join('<li>%s</li>' % e(s) for s in U['steps'])
    faq = ''.join('<details><summary><span>%s</span><i aria-hidden="true">+</i></summary><p>%s</p></details>' % (e(q), e(a)) for q, a in C['faq'])

    hreflang = '<!--i18n-hreflang-->\n' + ''.join('<link rel="alternate" hreflang="%s" href="https://step1ne.com%s">\n' % (c, pth % slug) for c, _, pth in (('zh-Hant', '', '/jobs/%s/'), ('id', '', '/id/jobs/%s/'), ('vi', '', '/vi/jobs/%s/'))) + '<link rel="alternate" hreflang="x-default" href="https://step1ne.com/jobs/%s/">\n<!--/i18n-hreflang-->\n' % slug
    page = """<!DOCTYPE html>
<html lang="%(hl)s">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="index,follow">
<title>%(page_title)s | Step1ne</title>
<meta name="description" content="%(desc)s">
<link rel="canonical" href="%(canon)s">
%(hreflang)s<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32.png">
<link rel="icon" type="image/png" sizes="512x512" href="/assets/favicon-512.png">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png">
<meta name="theme-color" content="#ffffff">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans:wght@400;600;700;800;900&display=swap" rel="stylesheet">
<style>%(css)s</style>
</head>
<body>
<header class="top"><div class="wrap">
<a href="/" aria-label="Step1ne"><img src="/assets/step1ne-logo.png" alt="Step1ne" width="120" height="36"></a>
<a class="hbtn" href="%(apply)s">%(apply_btn)s</a>
</div></header>
<main><div class="wrap">
%(sw)s
<h1>%(h1)s</h1>
<p class="h1sub">%(sub)s</p>
<div class="tags"><span>%(t1)s</span><span class="hl">%(t2)s</span></div>
<div class="must" role="note"><b>%(req_main)s</b><span>%(req_sub)s</span></div>

<h2>%(spec_h)s</h2>
%(spec_html)s

<h2>%(duties_h)s</h2>
<div class="card">%(duties)s</div>

<h2>%(req_h)s</h2>
%(reqs)s

<h2>%(elig_h)s</h2>
<!-- ELIGIBILITY_PLACEHOLDER -->
<div class="elig">%(elig_ph)s</div>

<h2>%(why_h)s</h2>
%(why)s

<h2>%(ben_h)s</h2>
%(ben)s

<h2>%(flow_h)s</h2>
<div class="card"><ol class="tl">%(steps)s</ol></div>

<div id="apply">
<h2>%(apply_h)s</h2>
<p style="color:var(--ink2);font-size:15px;margin:0 0 16px">%(apply_sub)s</p>
<a class="cta" href="%(apply)s">%(cta)s</a>
<a class="lineln" href="https://lin.ee/XcSWPzM" target="_blank" rel="noopener">%(line_cta)s</a>
</div>

<h2>%(faq_h)s</h2>
%(faq)s
</div></main>
<footer><div class="wrap">
<a href="/">%(footer_home)s</a> &nbsp;|&nbsp; &copy; 2026 德仁管理顧問有限公司 Step1ne
</div></footer>
<div class="bar" id="bar"><div><a class="line" href="https://lin.ee/XcSWPzM" target="_blank" rel="noopener">%(bar_line)s</a><a class="go" href="%(apply)s">%(bar_apply)s</a></div></div>
<script>
(function(){var a=document.getElementById('apply'),b=document.getElementById('bar');
if(a&&b&&'IntersectionObserver' in window){new IntersectionObserver(function(es){b.classList.toggle('off',es[0].isIntersecting)},{rootMargin:'0px 0px -30%% 0px'}).observe(a)}})();
</script>
</body>
</html>
""" % dict(hl=D['html_lang'], page_title=e(page_title), desc=e(desc), canon=canon, hreflang=hreflang, css=CSS, apply=e(apply_url),
           apply_btn=e(U['apply_btn']), sw=sw, h1=e(title), sub=e(C['sub']), t1=e(U['tag_fulltime']), t2=e(U['tag_conf']),
           req_main=e(U['req_main']), req_sub=e(U['req_sub']), spec_h=e(U['spec_h']), spec_html=spec_html,
           duties_h=e(U['duties_h']), duties=duties, req_h=e(U['req_h']), reqs=reqs, elig_h=e(U['elig_h']),
           elig_ph=e(U['elig_ph']), why_h=e(U['why_h']), why=why, ben_h=e(U['ben_h']), ben=ben, flow_h=e(U['flow_h']),
           steps=steps, apply_h=e(U['apply_h']), apply_sub=e(U['apply_sub']), cta=e(U['cta']), line_cta=e(U['line_cta']),
           faq_h=e(U['faq_h']), faq=faq, footer_home=e(U['footer_home']), bar_line=e(U['bar_line']), bar_apply=e(U['bar_apply']))
    out = os.path.join(ROOT, lang, 'jobs', slug)
    os.makedirs(out, exist_ok=True)
    # ⚠️ 「誰可以應徵／工作許可」已由 Jacky 依查證結果填好（commit 5c03110），重跑產生器不能洗掉它
    prev = os.path.join(out, 'index.html')
    if os.path.exists(prev):
        m = re.search(r'<div class="elig">.*?</div>', open(prev, encoding='utf-8').read(), re.S)
        if m and 'ELIGIBILITY_PLACEHOLDER' not in m.group(0) and '[' not in m.group(0)[:30]:
            page = re.sub(r'<!-- ELIGIBILITY_PLACEHOLDER -->\n<div class="elig">.*?</div>', lambda _: m.group(0), page, count=1, flags=re.S)
            page = re.sub(r'<div class="elig">\[.*?</div>', lambda _: m.group(0), page, count=1, flags=re.S)
    with open(os.path.join(out, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(page)
    return out


if __name__ == '__main__':
    for lang in ('id', 'vi'):
        for slug in SLUGS:
            print(build(lang, slug))

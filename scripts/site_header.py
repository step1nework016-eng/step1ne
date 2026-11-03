# -*- coding: utf-8 -*-
"""全站頁首（2026-11-03 Jacky 選方向 A）：Logo｜企業 2 項｜求職 3 項｜更多▾ ········ 中｜日｜EN ＋ LINE。
手機收進漢堡選單，語言切換放在選單最上面。

為什麼是一支共用程式：原本全站有 6 種頁首寫法（首頁、職缺頁、文章頁、應徵頁…各寫各的），
導覽字被擠成兩三行、語言切換另外佔一整排。現在 i18n_site.py 產頁時把每頁的舊頁首換成這一個，
中文頁重新產出（publish_job、文章發布）後跑 i18n_sync 也會再換一次，所以不會長回舊樣子。
要改頁首只改這支。"""
T = {
 'zh': dict(emp='企業', seek='求職', hire='委託招募', assess='招募形式評估', jobs='職缺', ref='全民獵才', ai='AI 求職工具',
            more='更多', col='獵才專欄', rev='人選評價', faq='常見問題', about='關於我們', team='顧問團隊', line='LINE 洽詢',
            menu='選單', close='關閉', tag='以台灣為主，台灣與日本都有職缺', lang='語言', seekB='找工作', empB='找人才'),
 'ja': dict(emp='企業', seek='求職', hire='採用代行', assess='採用診断', jobs='求人', ref='紹介プログラム', ai='AIツール',
            more='その他', col='コラム', rev='利用者の声', faq='FAQ', about='会社概要', team='コンサルタント', line='LINEで相談',
            menu='メニュー', close='閉じる', tag='台湾を拠点に、台湾と日本の求人を扱っています', lang='言語', seekB='仕事を探す', empB='人材を探す'),
 'en': dict(emp='Employers', seek='Job seekers', hire='Hiring services', assess='Assessment', jobs='Jobs', ref='Referrals', ai='AI tools',
            more='More', col='Insights', rev='Reviews', faq='FAQ', about='About', team='Team', line='Chat on LINE',
            menu='Menu', close='Close', tag='Based in Taiwan, with openings in Taiwan and Japan', lang='Language', seekB='Find a job', empB='Find talent'),
}
PRE = {'zh': '', 'ja': '/ja', 'en': '/en'}
LANG_LABEL = [('zh', '中', 'zh-Hant', '中文'), ('ja', '日', 'ja', '日本語'), ('en', 'EN', 'en', 'English'),
              ('id', 'ID', 'id', 'Bahasa Indonesia'), ('vi', 'VI', 'vi', 'Tiếng Việt')]

def urls(lang, path_for):
    p = PRE[lang]
    return dict(hire=p+'/commission-recruiting/', assess=p+'/hiring-assessment/', jobs=p+'/jobs/', ref=p+'/talent/',
                ai=p+'/talent/ai-tools/', col=p+'/articles/', rev='/reviews/', faq=p+'/faq/', about=p+'/about/', team=p+'/team/',
                home=(p or '') + '/')

def extra_langs(cur, path_for):
    """電腦版「更多」裡的其他語言（印尼文／越南文只有部分職缺有），免得頁首語言鈕太長。"""
    return ''.join('<a href="%s" lang="%s" hreflang="%s">%s</a>' % (path_for(c), hl, hl, full)
                   for c, short, hl, full in LANG_LABEL[3:] if c != cur and path_for(c))


def langsw(cur, path_for, cls='s1h-lang', main_only=False):
    """path_for(code) 回傳該語言版本的網址；沒有那個語言版本就回 None（例：只有 BIM 職缺有印尼文／越南文）。"""
    out = ['<div class="%s" role="group" aria-label="%s">' % (cls, {'zh': '切換語言', 'ja': '言語を切り替える', 'en': 'Change language'}[cur])]
    for code, short, hl, full in LANG_LABEL:
        if code != cur and not path_for(code):
            continue
        if main_only and code in ('id', 'vi') and code != cur:
            continue
        if code == cur:
            out.append('<span aria-current="true" lang="%s" title="%s">%s</span>' % (hl, full, short))
        else:
            out.append('<a href="%s" lang="%s" hreflang="%s" title="%s">%s</a>' % (path_for(code), hl, hl, full, short))
    out.append('</div>')
    return ''.join(out)

CSS_COMMON = """
.s1h{display:block;padding:0;margin:0;gap:0;font-size:16px;font-weight:400;line-height:1.5;text-align:left;--ink:#0F2233;--brand:#1880B4;--line:#DCE3EA;--mut:#5B6B7A;--paper:#fff;--ok:#06C755;font-family:"Noto Sans TC","Noto Sans JP","PingFang TC","Hiragino Sans",system-ui,sans-serif;position:sticky;top:0;z-index:70;background:var(--paper);border-bottom:1px solid var(--line);color:var(--ink)}
.s1h *{box-sizing:border-box}
.s1h a{color:inherit;text-decoration:none}
.s1h a:focus-visible,.s1h button:focus-visible,.s1h summary:focus-visible{outline:3px solid var(--brand);outline-offset:2px;border-radius:6px}
.s1h-in{max-width:1240px;margin:0 auto;padding:0 24px;display:flex;align-items:center;gap:20px}
.s1h-logo{display:flex;align-items:center;flex:none;min-height:44px}
.s1h-logo img{height:60px;width:60px;margin:-8px -6px;display:block}
.s1h-nav{display:flex;align-items:center;gap:6px;white-space:nowrap}
.s1h-nav a,.s1h-more>summary{display:inline-flex;align-items:center;min-height:44px;padding:0 10px;font-size:15px;font-weight:500;color:var(--ink);border-radius:8px;cursor:pointer}
.s1h-nav a:hover,.s1h-more>summary:hover{color:var(--brand)}
.s1h-grp{display:flex;align-items:center;gap:2px}
.s1h-gl{font-size:12px;color:var(--mut);margin-right:2px;white-space:nowrap}
.s1h-more{position:relative}
.s1h-more>summary{list-style:none}
.s1h-more>summary::-webkit-details-marker{display:none}
.s1h-more>summary::after{content:"";width:7px;height:7px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(45deg) translateY(-2px);margin-left:8px}
.s1h-more[open]>summary::after{transform:rotate(-135deg) translateY(-1px)}
.s1h-drop{position:absolute;top:calc(100% + 6px);left:0;min-width:200px;background:#fff;border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 30px rgba(15,34,51,.12);padding:6px;display:grid}
.s1h-drop a{display:flex;align-items:center;min-height:44px;padding:0 12px;border-radius:8px;font-size:15px}
.s1h-drop a:hover{background:#F1F5F9;color:var(--ink)}
.s1h-lang{display:inline-flex;align-items:center;border:1px solid var(--line);border-radius:999px;padding:3px;flex:none}
.s1h-lang a,.s1h-lang span{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:38px;padding:0 8px;border-radius:999px;font-size:13.5px;font-weight:600;color:var(--mut)}
.s1h-lang a:hover{color:var(--ink);background:#F1F5F9}
.s1h-lang span{background:var(--ink);color:#fff}
.s1h-cta{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 18px;border-radius:999px;background:var(--ok);color:#fff !important;font-weight:700;font-size:15px;white-space:nowrap;flex:none}
.s1h-cta:hover{filter:brightness(.95)}
.s1h-cta svg{width:18px;height:18px;flex:none}
.s1h-burger{display:none;align-items:center;justify-content:center;width:44px;height:44px;border:1px solid var(--line);border-radius:10px;background:#fff;cursor:pointer;flex:none}
.s1h-burger i{display:block;width:18px;height:2px;background:var(--ink);box-shadow:0 6px 0 var(--ink),0 -6px 0 var(--ink)}
.s1h-m{display:none;border-top:1px solid var(--line);background:#fff;padding:12px 16px 18px;max-height:calc(100vh - 64px);overflow:auto}
.s1h.open .s1h-m{display:block}
.s1h-m h3{font-size:12px;font-weight:500;color:var(--mut);margin:14px 4px 4px}
.s1h-m a.it{display:flex;align-items:center;min-height:48px;padding:0 4px;font-size:16px;border-bottom:1px solid #EEF2F6}
.s1h-m .s1h-lang{margin:4px 0 6px}
.s1h-m .s1h-cta{margin-top:16px;width:100%;justify-content:center}
@media (prefers-reduced-motion:no-preference){.s1h-drop{animation:s1hIn .14s ease-out}@keyframes s1hIn{from{opacity:0;transform:translateY(-4px)}}}
"""

LINE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 3C6.5 3 2 6.6 2 11c0 3.9 3.5 7.2 8.3 7.9.3.1.8.2.9.5.1.3.1.7 0 1l-.1.9c0 .3-.2 1 .9.6 1.1-.5 5.9-3.5 8.1-6C21.4 14.3 22 12.7 22 11c0-4.4-4.5-8-10-8z"/></svg>'

def mobile_menu(t, u, lang, path_for):
    return ('<div class="s1h-m" id="s1hM">' + langsw(lang, path_for) +
            '<h3>%s</h3><a class="it" href="%s">%s</a><a class="it" href="%s">%s</a><a class="it" href="%s">%s</a>' % (t['seekB'], u['jobs'], t['jobs'], u['ref'], t['ref'], u['ai'], t['ai']) +
            '<h3>%s</h3><a class="it" href="%s">%s</a><a class="it" href="%s">%s</a>' % (t['empB'], u['hire'], t['hire'], u['assess'], t['assess']) +
            '<h3>%s</h3>' % t['more'] + ''.join('<a class="it" href="%s">%s</a>' % (u[k], t[k]) for k in ('col', 'rev', 'faq', 'about', 'team')) +
            '<a class="s1h-cta" href="https://lin.ee/XcSWPzM" target="_blank" rel="noopener">%s%s</a></div>' % (LINE_SVG, t['line']))

BURGER = ('<button class="s1h-burger" type="button" aria-controls="s1hM" aria-expanded="false" aria-label="%s" '
          'onclick="var h=this.closest(\'.s1h\');h.classList.toggle(\'open\');this.setAttribute(\'aria-expanded\',h.classList.contains(\'open\'))"><i></i></button>')

def header(lang, path_for):
    t = T[lang]; u = urls(lang, path_for)
    more = ''.join('<a href="%s">%s</a>' % (u[k], t[k]) for k in ('col', 'rev', 'faq', 'about', 'team')) + extra_langs(lang, path_for)
    css = CSS_COMMON + """
.s1h-a .s1h-in{height:68px}
.s1h-a .s1h-nav{margin-left:8px}
.s1h-a .s1h-sep{width:1px;height:22px;background:var(--line);margin:0 10px}
.s1h-a .s1h-right{margin-left:auto;display:flex;align-items:center;gap:12px}
@media (max-width:1180px){.s1h-a .s1h-gl{display:none}.s1h-a .s1h-sep{margin:0 4px}}
html[lang=en] .s1h-a .s1h-gl{display:none}
@media (max-width:%dpx){.s1h-a .s1h-nav,.s1h-a .s1h-right .s1h-lang{display:none}.s1h-a .s1h-burger{display:inline-flex}.s1h-a .s1h-in{height:64px;padding:0 16px;gap:10px}.s1h-a .s1h-cta{padding:0 14px;font-size:14px}}
@media (max-width:420px){.s1h-a .s1h-cta span.long{display:none}}
""" % (1060 if lang == 'en' else 980)
    return ('<style>%s</style><header class="s1h s1h-a"><div class="s1h-in">' % css +
            '<a class="s1h-logo" href="%s"><img src="/assets/step1ne-logo.png" alt="Step1ne" width="60" height="60"></a>' % u['home'] +
            '<nav class="s1h-nav" aria-label="%s">' % t['menu'] +
            '<div class="s1h-grp"><span class="s1h-gl">%s</span><a href="%s">%s</a><a href="%s">%s</a></div>' % (t['emp'], u['hire'], t['hire'], u['assess'], t['assess']) +
            '<span class="s1h-sep" aria-hidden="true"></span>' +
            '<div class="s1h-grp"><span class="s1h-gl">%s</span><a href="%s">%s</a><a href="%s">%s</a><a href="%s">%s</a></div>' % (t['seek'], u['jobs'], t['jobs'], u['ref'], t['ref'], u['ai'], t['ai']) +
            '<span class="s1h-sep" aria-hidden="true"></span>' +
            '<details class="s1h-more"><summary>%s</summary><div class="s1h-drop">%s</div></details></nav>' % (t['more'], more) +
            '<div class="s1h-right">%s<a class="s1h-cta" href="https://lin.ee/XcSWPzM" target="_blank" rel="noopener">%s<span>%s</span></a>%s</div>' % (langsw(lang, path_for, main_only=True), LINE_SVG, t['line'], BURGER % t['menu']) +
            '</div>' + mobile_menu(t, u, lang, path_for) + '</header>')


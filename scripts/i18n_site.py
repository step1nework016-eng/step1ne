# -*- coding: utf-8 -*-
"""日文／英文版產生器：以中文頁為底，產出 /ja/<路徑> 與 /en/<路徑>。

## 為什麼這樣做（2026-11-03 Jacky：全站要能切換 中文／日本語／English，定位是國際化）
中文頁一直在改（手寫頁、publish_job.py 產的職缺頁、排程發的文章）。如果日英版是另外
手刻的一份，下次中文改了就會脫節。所以日英版**永遠從中文頁產生**：

  1. 把中文頁切成「一段一段」：一個段落／一個列表項目（含裡面的粗體、連結）、
     meta 說明、圖片 alt、結構化資料裡的字串。
  2. 每一段去「翻譯對照本」（scripts/i18n_tm/ja.json、en.json）查翻譯。
  3. 中文改了 → 只有改到的那幾段查不到 → 只翻那幾段（--auto 會叫 claude -p 翻），
     其他段落照舊，翻譯不會每次重寫一遍。
  4. 換上翻譯、改 html lang／canonical／hreflang、加語言切換、站內連結改到同語言版本。

## 硬規則（翻譯提示詞與檢查都照這幾條）
- 對外不寫客戶名（日文、英文、羅馬拼音都算）→ 產完一律跑 check_no_client_names.py。
- 薪資照中文頁原本的數字，不換算幣別、不推估 → check_numbers() 逐段比對數字。
- 不寫客戶數、職缺數、上線日、服務幾國這類規模數字。
- 品牌：日英版只寫「Step1ne」（Jacky 11/3 核准）。
- 阿財面談與顧問聯絡都是中文 → 職缺頁、應徵頁照實註明。

用法（從專案根目錄）：
  python3 scripts/i18n_site.py               # 依 PAGES 產全部日英頁；有缺翻譯的段落就列出來並停下
  python3 scripts/i18n_site.py --dump DIR    # 把缺翻譯的段落寫成 DIR/missing.json（給人或 AI 翻）
  python3 scripts/i18n_site.py --load FILE   # 把翻好的 {ja:{..},en:{..}} 併進對照本
  python3 scripts/i18n_site.py --auto        # 缺的段落直接叫 claude -p 翻（ship.sh 用這個）
  python3 scripts/i18n_site.py --check       # 只檢查，不寫檔：有缺翻譯或中文頁比日英頁新就 exit 1
"""
import os, re, sys, json, glob, hashlib, subprocess, shutil, html as H

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
TMDIR = os.path.join(ROOT, 'scripts', 'i18n_tm')
BASE = 'https://step1ne.com'
LANGS = ('ja', 'en')
# 預覽模式：日英頁先上線給 Jacky 看手機版，但 Google 不收（noindex）、中文頁不放切換、不進 sitemap。
# Jacky 看過說可以 → 改成 False 再跑一次 ship.sh，就是正式公開。
PREVIEW = False
HTML_LANG = {'ja': 'ja', 'en': 'en'}
OG_LOCALE = {'ja': 'ja_JP', 'en': 'en_US'}
CJK = re.compile(r'[㐀-鿿豈-﫿]')

# ── 要產日英版的頁面（中文路徑）。職缺頁另外依 JOB_SLUGS 加進來 ──
# 第 1 批（11/3）首頁、職缺專區、應徵頁；第 2 批（11/3）固定頁。之後的批次往這裡加。
# 不做日英版的：/reviews/（評價是人選寫的中文原文）、/appointment/（顧問寄給個人的預約連結）、
# /apply-quick/（BIM 培訓職缺專用，已有印尼文／越南文版另外產）。
PAGES = ['index.html', 'jobs/index.html', 'apply/index.html', 'apply-general/index.html',
         'about/index.html', 'commission-recruiting/index.html', 'talent/index.html', 'talent/ai-tools/index.html',
         'faq/index.html', 'team/index.html', 'success-stories/index.html', 'construction/index.html',
         'training/index.html', 'hiring-assessment/index.html']
# 這幾頁的程式裡有要顯示給人看的中文訊息（送出中…、寄送失敗…），字串也要翻。
# 其他頁的程式字串一律不碰：可能是拿來比對資料的值，翻了會壞。
JS_PAGES = {'hiring-assessment/index.html', 'apply-general/index.html', 'articles/index.html'}

CLOSED_API = 'https://step1ne-public-worker.aiagentg888.workers.dev/jobs-closed'
_JOBS = None


def job_slugs():
    """職缺頁全部都做：中文職缺專區列表上的卡片，扣掉顧問在後台關掉的（跟中文列表頁一樣問後端）。
    新職缺上架 → 自動多一頁；職缺關閉 → 日英頁自動拿掉。後端問不到就退回只看 sitemap 有沒有收。"""
    global _JOBS
    if _JOBS is not None:
        return _JOBS
    zh = open(os.path.join(ROOT, 'jobs', 'index.html'), encoding='utf-8').read()
    cards = re.findall(r'<a class="job" href="/jobs/([^/"]+)/"', zh)
    try:
        import urllib.request
        closed = set(json.load(urllib.request.urlopen(CLOSED_API, timeout=20)).get('closed') or [])
        ok = lambda x: x not in closed
    except Exception:
        sm = open(os.path.join(ROOT, 'sitemap.xml'), encoding='utf-8').read()
        ok = lambda x: '/jobs/%s/<' % x in sm
    _JOBS = [x for x in dict.fromkeys(cards) if ok(x) and os.path.exists(os.path.join(ROOT, 'jobs', x, 'index.html'))]
    return _JOBS


INLINE = {'a', 'b', 'strong', 'em', 'i', 'span', 'small', 'br', 'code', 'mark', 'sup', 'sub', 'u', 's',
          'time', 'abbr', 'wbr', 'img', 'q', 'cite', 'label', 'bdi'}
VOID = {'br', 'img', 'wbr', 'input', 'meta', 'link', 'hr', 'source'}
TR_ATTRS = ('alt', 'title', 'aria-label', 'placeholder')
TR_META = {'description', 'keywords', 'og:title', 'og:description', 'og:site_name', 'og:image:alt',
           'twitter:title', 'twitter:description', 'twitter:image:alt'}
# 日英版不載入的共用程式：這兩支都靠中文字認段落／畫中文介面，日英頁上會認錯
DROP_SCRIPTS = ('/assets/reviews.js', '/assets/job-detail-m.js')

TOK = re.compile(r'<!--.*?-->|<(script|style)\b[^>]*>.*?</\1\s*>|<[!/]?[a-zA-Z][^>]*>|[^<]+|<', re.S | re.I)
ATTR = re.compile(r'''([a-zA-Z_:][-a-zA-Z0-9_:.]*)(\s*=\s*(?:"([^"]*)"|'([^']*)'))?''')


def norm(s):
    return re.sub(r'\s+', ' ', s).strip()


# ───────────────────────── 切段＋替換（同一條路，extract 時 tr 只記錄）─────────────────────────
def tag_name(tok):
    m = re.match(r'</?([a-zA-Z][a-zA-Z0-9]*)', tok)
    return m.group(1).lower() if m else ''


def balanced(toks):
    st = []
    for t in toks:
        if not t.startswith('<'):
            continue
        n = tag_name(t)
        if n in VOID or t.endswith('/>'):
            continue
        if t.startswith('</'):
            if not st or st[-1] != n:
                return False
            st.pop()
        else:
            st.append(n)
    return not st


def tr_attrs(tok, tr):
    """把標籤裡要翻的屬性換掉。<option> 沒 value 的補上中文原值，送給後端的值才不會變成日文。"""
    n = tag_name(tok)
    if tok.startswith('</') or not n:
        return tok
    attrs = {m.group(1).lower(): (m.group(3) if m.group(3) is not None else m.group(4)) for m in ATTR.finditer(tok[len(n) + 1:])}
    out = tok
    if n == 'meta':
        key = (attrs.get('name') or attrs.get('property') or '').lower()
        if key in TR_META and attrs.get('content') and CJK.search(attrs['content']):
            out = out.replace('content="%s"' % attrs['content'], 'content="%s"' % H.escape(tr('attr', H.unescape(attrs['content'])), quote=True), 1)
        return out
    for a in TR_ATTRS:
        v = attrs.get(a)
        if v and CJK.search(v):
            out = re.sub(r'(\s%s\s*=\s*)"%s"' % (re.escape(a), re.escape(v)),
                         lambda m: m.group(1) + '"%s"' % H.escape(tr('attr', H.unescape(v)), quote=True), out, count=1)
    if n == 'input' and (attrs.get('type') or '').lower() in ('submit', 'button') and attrs.get('value') and CJK.search(attrs['value']):
        v = attrs['value']
        out = out.replace('value="%s"' % v, 'value="%s"' % H.escape(tr('attr', H.unescape(v)), quote=True), 1)
    return out


def tr_jsonld(body, tr):
    try:
        d = json.loads(body)
    except Exception:
        return body

    def walk(x, k=None):
        if isinstance(x, dict):
            return {kk: walk(v, kk) for kk, v in x.items()}
        if isinstance(x, list):
            return [walk(v, k) for v in x]
        if isinstance(x, str) and CJK.search(x) and k not in ('@type', '@context', 'url', '@id', 'logo', 'image', 'sameAs'):
            return tr('text', x)
        return x
    return '\n' + json.dumps(walk(d), ensure_ascii=False, indent=2) + '\n'


JS_STR = re.compile(r"//[^\n]*|'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"")


def tr_js(t, tr):
    """只翻程式裡含中文的字串（'送出中…' 這種）；註解原樣保留。"""
    def f(m):
        if m.group(0).startswith('//'):
            return m.group(0)
        q = "'" if m.group(1) is not None else '"'
        inner = m.group(1) if m.group(1) is not None else m.group(2)
        if not CJK.search(inner):
            return m.group(0)
        out = tr('js', inner)
        if out == inner:
            return m.group(0)
        return q + out.replace('\\', '\\\\').replace(q, '\\' + q) + q
    return JS_STR.sub(f, t)


def process(src, tr, option_values=True, js=False):
    out, run = [], []

    def flush():
        if not run:
            return
        joined = ''.join(run)
        if CJK.search(re.sub(r'<[^>]+>', '', joined)) and balanced(run):
            m = re.match(r'^(\s*)(.*?)(\s*)$', joined, re.S)
            out.append(m.group(1) + tr('html', m.group(2)) + m.group(3))
        else:
            for t in run:
                if t.startswith('<'):
                    out.append(tr_attrs(t, tr))
                elif CJK.search(t):
                    m = re.match(r'^(\s*)(.*?)(\s*)$', t, re.S)
                    out.append(m.group(1) + tr('html', m.group(2)) + m.group(3))
                else:
                    out.append(t)
        run.clear()

    pending_opt = None
    for m in TOK.finditer(src):
        t = m.group(0)
        if t.startswith('<!--'):
            flush()
            out.append('' if CJK.search(t) and not t.startswith('<!--i18n') else t)
            continue
        if m.group(1):
            flush()
            if m.group(1).lower() == 'script' and 'ld+json' in t[:80]:
                a = t.index('>') + 1
                b = t.lower().rindex('</script')
                out.append(t[:a] + tr_jsonld(t[a:b], tr) + t[b:])
            elif js and m.group(1).lower() == 'script':
                out.append(tr_js(t, tr))
            else:
                out.append(t)
            continue
        if t.startswith('<'):
            n = tag_name(t)
            if n == 'option' and not t.startswith('</') and option_values and 'value=' not in t:
                flush()
                pending_opt = len(out)
                out.append(t)
                continue
            if n in INLINE and pending_opt is None:
                run.append(t)
                continue
            flush()
            if n == 'option' and t.startswith('</') and pending_opt is not None:
                # 補 value＝中文原文，再翻顯示文字
                txt = ''.join(out[pending_opt + 1:])
                zh = H.unescape(norm(txt))
                out[pending_opt] = out[pending_opt][:-1] + ' value="%s">' % H.escape(zh, quote=True)
                del out[pending_opt + 1:]
                out.append(tr('html', txt.strip()) if CJK.search(txt) else txt)
                pending_opt = None
            out.append(tr_attrs(t, tr))
            continue
        if pending_opt is not None:
            out.append(t)
            continue
        run.append(t)
    flush()
    return ''.join(out)


# ───────────────────────── 翻譯對照本 ─────────────────────────
def key(s):
    return norm(s)


def load_tm():
    tm = {}
    for l in LANGS:
        p = os.path.join(TMDIR, l + '.json')
        tm[l] = json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}
    return tm


def save_tm(tm):
    os.makedirs(TMDIR, exist_ok=True)
    for l in LANGS:
        json.dump(dict(sorted(tm[l].items())), open(os.path.join(TMDIR, l + '.json'), 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=1)


NUM = re.compile(r'\d[\d,]*(?:\.\d+)?')


# 中文有、但日英版刻意不寫的數字（官網不透露規模）：這種段落數字對不上是對的
NO_NUM_PAT = re.compile(r'個招募中|任用率|成功率|面試率|續約率|台積電')


WORDS = {1: ('one', 'single', 'a '), 2: ('two', 'twice', 'both'), 3: ('three',), 4: ('four',), 5: ('five',), 6: ('six',),
         7: ('seven',), 8: ('eight',), 9: ('nine',), 10: ('ten',), 11: ('eleven',), 12: ('twelve',)}
MONTHS = ('january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december')


def _fmt(v):
    return ('%f' % v).rstrip('0').rstrip('.')


def check_numbers(zh, out, lang):
    """中文段落裡的每個數字，翻譯裡都要找得到。允許的換寫：
    「X 萬」→ X×10000 或 X×10000/百萬（2.7 million）；「3萬5」→ 35000；「4萬833」→ 40833；「XK」→ ×1000；
    「X 成」→ X0%；1～12 可寫成英文數字詞（one-on-one、eight）或英文月名（8月→August）；日期前面的 0 可省。
    標籤裡的數字（style 顏色、網址）不算。"""
    if NO_NUM_PAT.search(zh):
        return None
    zt = re.sub(r'<[^>]+>', ' ', zh)
    ot = re.sub(r'<[^>]+>', ' ', out)
    have = set(n.replace(',', '') for n in NUM.findall(ot))
    low = ot.lower()
    # 「3萬5」「4 萬 833」這種組合：先算出整數，兩個數字都算通過
    combo_ok = set()
    for m in re.finditer(r'(\d+)\s*萬\s*(\d+)', zt):
        a, b = int(m.group(1)), m.group(2)
        v = a * 10000 + (int(b) * 1000 if len(b) == 1 else int(b))
        if str(v) in have:
            combo_ok.update({m.group(1), b})
    toks = list(re.finditer(r'(\d[\d,]*(?:\.\d+)?)\s*(萬|億|K|成|月)?', zt))
    for i, m in enumerate(toks):
        n = m.group(1).replace(',', '')
        unit = m.group(2)
        if not unit and i + 1 < len(toks) and re.fullmatch(r'\s*[–～~\-－至到]\s*', zt[m.end():toks[i + 1].start()]):
            unit = toks[i + 1].group(2)       # 「500–850 萬」的 500 也是萬
        if n in have or n.lstrip('0') in have or n.lstrip('0') == '' or n in combo_ok:
            continue
        try:
            v = float(n)
        except ValueError:
            return n
        if unit == '萬' and (_fmt(v * 10000) in have or _fmt(v / 100) in have):
            continue
        if unit == '億' and (_fmt(v * 100000000) in have or _fmt(v * 100) in have or _fmt(v / 10) in have):
            continue
        if unit == 'K' and _fmt(v * 1000) in have:
            continue
        if unit == '成' and _fmt(v * 10) in have:
            continue
        if v == int(v) and 1 <= v <= 12:
            if unit == '月' and MONTHS[int(v) - 1] in low:
                continue
            if any(w in low for w in WORDS.get(int(v), ())) or 'one-on-one' in low:
                continue
            if lang == 'ja' and ('マンツーマン' in ot or '一' in ot):
                continue
        return n
    return None


# ───────────────────────── 頁面層級：路徑、連結、head、切換 ─────────────────────────
def page_url(rel, lang=None):
    p = '/' + rel[:-len('index.html')] if rel.endswith('index.html') else '/' + rel
    return ('/%s%s' % (lang, p)) if lang else p


def article_pages():
    """第 3 批（11/3）：獵才專欄全部文章＋列表頁。中文設成 noindex 的（抖音／直播 4 篇）不做。
    新文章由 article_publish_tick.py 發布時呼叫 i18n_sync，自動多出日英版。"""
    out = ['articles/index.html']
    for p in sorted(glob.glob(os.path.join(ROOT, 'articles', '*', 'index.html'))):
        s = open(p, encoding='utf-8').read()
        if re.search(r'<meta name="robots" content="noindex', s):
            continue
        out.append(os.path.relpath(p, ROOT))
    return out


def all_pages():
    return PAGES + ['jobs/%s/index.html' % s for s in job_slugs()] + article_pages()


def has_version(path, lang):
    """站內連結 /x/y/ 有沒有對應的日英版（產這一批的頁面，或已經存在的檔案）。"""
    path = path.split('#')[0].split('?')[0]
    rel = (path.lstrip('/') + 'index.html') if path.endswith('/') else path.lstrip('/')
    return rel in all_pages() or os.path.exists(os.path.join(ROOT, lang, rel))


def rewrite_links(s, lang):
    def f(m):
        url = m.group(2)
        if url.startswith('/') and not url.startswith('//') and not url.startswith('/assets/') and has_version(url, lang):
            return m.group(1) + '/' + lang + url
        return m.group(0)
    s = re.sub(r'(href=")(/[^"]*)', f, s)
    s = re.sub(r'(href=")https://step1ne\.com(/[^"]*)', lambda m: f(m) if has_version(m.group(2), lang) else m.group(0), s)
    return s


HEAD_A, HEAD_B = '<!--i18n-hreflang-->', '<!--/i18n-hreflang-->'
SW_A, SW_B = '<!--i18n-switch-->', '<!--/i18n-switch-->'
NOTE_A, NOTE_B = '<!--i18n-note-->', '<!--/i18n-note-->'
LABEL = [('zh-Hant', '中文', None), ('ja', '日本語', 'ja'), ('en', 'English', 'en'),
         ('id', 'Bahasa Indonesia', 'id'), ('vi', 'Tiếng Việt', 'vi')]
SW_ARIA = {'zh-Hant': '切換語言', 'ja': '言語を切り替える', 'en': 'Change language'}
SWITCH_CSS = ('.s1-lang{max-width:1100px;margin:0 auto;padding:10px 16px 0;display:flex;flex-wrap:wrap;gap:6px;align-items:center}'
              '.s1-lang a,.s1-lang b{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:999px;'
              'border:1px solid #d9dce3;background:#fff;font-size:14px;font-weight:600;color:#4a5060;text-decoration:none}'
              '.s1-lang b{background:#23262d;border-color:#23262d;color:#fff}'
              '.s1-lang a:hover{color:#23262d;border-color:#9aa0ad}.s1-lang a:focus-visible{outline:3px solid #1880B4;outline-offset:2px}'
              '.s1-note{max-width:1100px;margin:10px auto 0;padding:0 16px}'
              '.s1-note p{margin:0;padding:12px 14px;border-radius:12px;background:#eef4fb;border:1px solid #c9dcef;color:#1d3a57;font-size:14.5px;line-height:1.7}')
NOTE = {
    'ja': '応募後のAI面接（阿財）と担当コンサルタントとのやり取りは、中国語で行います。',
    'en': 'After you apply, the AI interview (A-Cai) and all contact with our consultants are conducted in Chinese (Mandarin).',
}


def langs_of(rel):
    out = ['zh-Hant']
    for code, _, pre in LABEL[1:]:
        if os.path.exists(os.path.join(ROOT, pre, rel)) or (pre in LANGS and rel in all_pages()):
            out.append(code)
    return out


def add_head(s, block):
    """放進 <head>。有些頁（例如 /apply/）原始碼沒有 <html><head>，直接放最前面，瀏覽器會歸到 head。"""
    if '</head>' in s:
        return s.replace('</head>', block + '</head>', 1)
    return block + s


def strip_i18n(s):
    # 跟加的時候對稱：head 那塊是「區塊＋換行」、切換列與說明是「換行＋區塊＋換行」
    s = re.sub(re.escape(HEAD_A) + r'.*?' + re.escape(HEAD_B) + r'\n?', '', s, flags=re.S)
    for a, b in ((SW_A, SW_B), (NOTE_A, NOTE_B)):
        s = re.sub(r'\n?' + re.escape(a) + r'.*?' + re.escape(b) + r'\n?', '', s, flags=re.S)
    return s


def head_block(rel, avail):
    lines = [HEAD_A]
    for code, _, pre in LABEL:
        if code in avail:
            lines.append('<link rel="alternate" hreflang="%s" href="%s%s">' % (code, BASE, page_url(rel, pre)))
    lines.append('<link rel="alternate" hreflang="x-default" href="%s%s">' % (BASE, page_url(rel)))
    lines.append('<style>%s</style>' % SWITCH_CSS)
    lines.append(HEAD_B)
    return '\n'.join(lines) + '\n'


def switch_block(rel, avail, cur):
    items = []
    for code, name, pre in LABEL:
        if code not in avail:
            continue
        if code == cur:
            items.append('<b lang="%s" aria-current="true">%s</b>' % (code, name))
        else:
            items.append('<a href="%s" hreflang="%s" lang="%s">%s</a>' % (page_url(rel, pre), code, code, name))
    return '%s<nav class="s1-lang" aria-label="%s">%s</nav>%s' % (SW_A, SW_ARIA.get(cur, 'Language'), ''.join(items), SW_B)


def insert_after_header(s, block):
    """放在頁首導覽列下面。頁首有的頁是 <header>，有的是 <nav class="nav">（企業服務頁的 <header> 其實是大標題區），
    看 <body> 之後先出現哪一個就用哪一個。"""
    bi = s.find('<body')
    bi = 0 if bi < 0 else bi
    m = re.search(r'<(header|nav)\b', s[bi:])
    if m:
        close = '</%s>' % m.group(1)
        i = s.find(close, bi + m.start())
        if i >= 0:
            i += len(close)
            return s[:i] + '\n' + block + '\n' + s[i:]
    j = s.find('>', s.find('<body')) + 1
    return s[:j] + '\n' + block + '\n' + s[j:]


def inject(s, rel, cur):
    """hreflang＋語言切換（中文頁也用這支；重複執行結果一樣）。"""
    s = strip_i18n(s)
    avail = langs_of(rel)
    if len(avail) < 2:
        return s
    s = add_head(s, head_block(rel, avail))
    s = insert_after_header(s, switch_block(rel, avail, cur))
    return s


def set_head(s, rel, lang):
    if '<html' in s:
        s = re.sub(r'<html lang="[^"]*"', '<html lang="%s"' % HTML_LANG[lang], s, count=1)
    else:
        s = '<html lang="%s">\n' % HTML_LANG[lang] + s
    url = BASE + page_url(rel, lang)
    s = re.sub(r'<link rel="canonical"[^>]*>', '<link rel="canonical" href="%s">' % url, s)
    if 'rel="canonical"' not in s:
        s = add_head(s, '<link rel="canonical" href="%s">\n' % url)
    s = re.sub(r'<meta property="og:url"[^>]*>', '<meta property="og:url" content="%s">' % url, s)
    s = re.sub(r'<meta property="og:locale"[^>]*>', '<meta property="og:locale" content="%s">' % OG_LOCALE[lang], s)
    if 'og:locale' not in s:
        s = add_head(s, '<meta property="og:locale" content="%s">\n' % OG_LOCALE[lang])
    s = re.sub(r'<link rel="alternate" hreflang="[^"]*"[^>]*>\n?', '', s)
    # 職缺頁先把整頁藏起來、等 job-detail-m.js 排好版才顯示；日英版不載那支，要一起拿掉，不然會空白 2.5 秒
    s = re.sub(r'<style>html\.jv-wait body\{opacity:0\}</style><script>.*?</script>', '', s, flags=re.S)
    for src in DROP_SCRIPTS:
        s = re.sub(r'<script[^>]*src="%s[^"]*"[^>]*></script>\n?' % re.escape(src), '', s)
    # JSON-LD 裡的本頁網址改成本語言
    s = s.replace('"url": "%s%s"' % (BASE, page_url(rel)), '"url": "%s"' % url)
    s = s.replace('"inLanguage": "zh-Hant"', '"inLanguage": "%s"' % HTML_LANG[lang])
    return s


# ── 個別頁面的調整（只有這幾頁需要）──
def cut(s, a, b, label):
    i = s.find(a)
    j = s.find(b, i)
    if i < 0 or j < 0:
        raise SystemExit('⛔ %s：找不到要拿掉的區塊（%s），中文頁改版了，先更新 i18n_site.py' % (label, a[:40]))
    return s[:i] + s[j:]


def page_fixups(s, rel, lang):
    if rel == 'jobs/index.html':
        # 篩選／搜尋／熱門職缺都是靠中文字比對的程式，日英版拿掉，只留有日英版的職缺卡片（靜態列出）
        s = re.sub(r'<style>html\.jl-wait #jobs\{opacity:0\}</style><script>.*?</script>\n?', '', s, flags=re.S)
        s = cut(s, '<div class="jv2-search">', '</div></section>', rel)
        s = cut(s, '<div class="jv2-filterrow">', '<div class="jobs" id="jobs">', rel)
        s = re.sub(r'<div class="empty" id="empty".*?</div>\n?', '', s, flags=re.S)
        keep = set(job_slugs())

        def card(m):
            slug = m.group(1)
            return m.group(0) if slug in keep else ''
        s = re.sub(r'\s*<a class="job" href="/(?:ja/|en/)?jobs/([^/]+)/".*?</a>', card, s, flags=re.S)

        # 列表頁的篩選程式（第二段 inline script，含 '財務・會計' 那些中文對照）拿掉
        s = re.sub(r'<script>(?:(?!</script>).)*?(?:jv2|filterSheet|hotJobs|jobs-rank)(?:(?!</script>).)*?</script>\n?', '', s, flags=re.S)
    return s


def needs_note(rel):
    return rel.startswith('jobs/') and rel != 'jobs/index.html' or rel.startswith('apply')


def build_page(rel, lang, tr):
    src = open(os.path.join(ROOT, rel), encoding='utf-8').read()
    src = page_fixups(strip_i18n(src), rel, lang)
    s = process(src, tr, option_values=rel.startswith('apply'), js=rel in JS_PAGES)
    s = set_head(s, rel, lang)
    s = rewrite_links(s, lang)
    if rel == 'jobs/index.html':
        # 還沒翻的職缺照實說在中文頁（第 2 批會補齊）。翻譯之後才加，免得被當成要翻的中文段落
        more = {'ja': 'その他の求人は<a href="/jobs/" lang="zh-Hant">中国語の求人一覧</a>でご覧いただけます。',
                'en': 'More openings are listed on our <a href="/jobs/" lang="zh-Hant">Chinese job board</a>.'}[lang]
        s = s.replace('<div class="jobs" id="jobs">', '<p class="s1-more" style="margin:0 0 14px;font-size:14.5px;color:#55585f">%s</p>\n      <div class="jobs" id="jobs">' % more, 1)
    s = inject(s, rel, lang)
    if PREVIEW:
        s = re.sub(r'<meta name="robots"[^>]*>\n?', '', s)
        s = add_head(s, '<meta name="robots" content="noindex,nofollow">\n')
    if needs_note(rel):
        s = insert_after_header(s, '%s<div class="s1-note"><p>%s</p></div>%s' % (NOTE_A, NOTE[lang], NOTE_B)) \
            if SW_B not in s else s.replace(SW_B, SW_B + '\n%s<div class="s1-note"><p>%s</p></div>%s' % (NOTE_A, NOTE[lang], NOTE_B), 1)
    return s


def update_sitemap(pages):
    """日英頁加進 sitemap（中文頁在不在 sitemap 由原本流程決定，日英頁只跟著中文頁）。"""
    p = os.path.join(ROOT, 'sitemap.xml')
    s = open(p, encoding='utf-8').read()
    add = []
    for rel in pages:
        zh = BASE + page_url(rel)
        if '<loc>%s</loc>' % zh not in s:
            continue
        for l in LANGS:
            u = BASE + page_url(rel, l)
            if '<loc>%s</loc>' % u not in s:
                add.append('  <url>\n    <loc>%s</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>' % u)
    # 已經不提供的日英頁從 sitemap 拿掉
    keep = set(BASE + page_url(r, l) for r in pages for l in LANGS)
    s2 = re.sub(r'\s*<url>\s*<loc>(%s/(?:ja|en)/[^<]*)</loc>.*?</url>' % re.escape(BASE),
                lambda m: m.group(0) if m.group(1) in keep else '', s, flags=re.S)
    if not add and s2 == s:
        return False
    s = s2.replace('</urlset>', '\n'.join(add) + '\n</urlset>', 1) if add else s2
    open(p, 'w', encoding='utf-8').write(s)
    return True


# ───────────────────────── 翻譯（缺的段落）─────────────────────────
PROMPT = open(os.path.join(os.path.dirname(__file__), 'i18n_prompt.md'), encoding='utf-8').read() \
    if os.path.exists(os.path.join(os.path.dirname(__file__), 'i18n_prompt.md')) else ''


def auto_translate(missing, tm):
    """缺的段落分批丟給 claude -p。回來先驗數字，沒過的不收。"""
    claude = shutil.which('claude') or 'claude'
    items = sorted(missing)
    for i in range(0, len(items), 40):
        chunk = {str(n): z for n, z in enumerate(items[i:i + 40])}
        prompt = PROMPT + '\n\n## 要翻的段落（JSON，key 是編號）\n' + json.dumps(chunk, ensure_ascii=False, indent=1) + \
            '\n\n只回 JSON：{"ja": {"編號": "日文"}, "en": {"編號": "英文"}}，不要任何說明。'
        env = dict(os.environ); env.pop('CLAUDECODE', None)
        r = subprocess.run([claude, '-p', '--model', 'claude-opus-5-5', '--output-format', 'text',
                            '--disallowedTools', 'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,Task'],
                           input=prompt, capture_output=True, text=True, env=env, timeout=900)
        out = r.stdout
        a, b = out.find('{'), out.rfind('}')
        if r.returncode != 0 or a < 0:
            raise SystemExit('⛔ 自動翻譯失敗：%s' % (r.stderr or out)[-300:])
        d = json.loads(out[a:b + 1])
        for l in LANGS:
            for n, t in d.get(l, {}).items():
                zh = chunk.get(n)
                if zh and t and not check_numbers(zh, t, l):
                    tm[l][key(zh)] = t
        save_tm(tm)


def run(mode, arg=None):
    tm = load_tm()
    missing = set()

    def mk(lang):
        def tr(kind, zh):
            k = key(zh)
            if not k or not CJK.search(re.sub(r'<[^>]+>', '', k) if kind == 'html' else k):
                return zh
            t = tm[lang].get(k)
            if t is None:
                missing.add(k)
                return zh
            return t
        return tr

    pages = all_pages()
    built = {}
    for rel in pages:
        if not os.path.exists(os.path.join(ROOT, rel)):
            continue
        for l in LANGS:
            built[(rel, l)] = build_page(rel, l, mk(l))

    if mode == 'dump':
        os.makedirs(arg, exist_ok=True)
        json.dump(sorted(missing), open(os.path.join(arg, 'missing.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print('缺翻譯 %d 段 → %s/missing.json' % (len(missing), arg))
        return 0
    if mode == 'auto' and len(missing) > 200:
        # 一次缺這麼多＝整批新頁面還沒翻（例如新加一整類頁面），不要在上線途中叫 claude -p 翻幾千段（Mac 會撐不住）。
        # 這種要另外分批翻：--dump 切份給譯者，翻好 --load。這次日英版維持原樣，中文照常上線。
        print('⚠️ 缺翻譯 %d 段，太多不自動翻（請用 --dump／--load 分批翻）。日英版這次不更新。' % len(missing))
        return 1
    if mode == 'auto' and missing:
        print('缺翻譯 %d 段，叫 claude -p 翻…' % len(missing))
        auto_translate(missing, tm)
        return run('build')
    if missing:
        print('⛔ 還有 %d 段沒有日文／英文翻譯（例：%s）。跑 --auto 或 --dump。' % (len(missing), sorted(missing)[0][:60]))
        return 1

    # 數字檢查（薪資不能被翻錯）
    bad = []
    nc = os.path.join(TMDIR, 'no_number_check.json')
    skip = set(json.load(open(nc, encoding='utf-8'))['keys']) if os.path.exists(nc) else set()
    for l in LANGS:
        for zh, t in tm[l].items():
            if zh in skip:
                continue
            n = check_numbers(zh, t, l)
            if n:
                bad.append('%s「%s…」少了數字 %s' % (l, zh[:30], n))
    if bad:
        print('⛔ 翻譯裡數字對不上：\n  ' + '\n  '.join(bad[:20]))
        return 1

    changed = 0
    touched = []
    for (rel, l), s in built.items():
        out = os.path.join(ROOT, l, rel)
        old = open(out, encoding='utf-8').read() if os.path.exists(out) else None
        if old != s:
            changed += 1
            if mode == 'check':
                continue
            os.makedirs(os.path.dirname(out), exist_ok=True)
            open(out, 'w', encoding='utf-8').write(s)
            touched.append(os.path.join(l, rel))
    # 中文頁已經不存在、或職缺已關閉的日英頁 → 一起拿掉
    want = set(pages)
    removed = []
    for l in LANGS:
        for p in glob.glob(os.path.join(ROOT, l, '**', 'index.html'), recursive=True):
            rel = os.path.relpath(p, os.path.join(ROOT, l))
            if rel not in want:
                removed.append(rel)
                print('職缺已關閉或中文頁已移除，拿掉 %s/%s' % (l, rel))
                if mode != 'check':
                    os.remove(p)
                    touched.append(os.path.join(l, rel))
                changed += 1
    # 中文頁：加 hreflang＋語言切換（預覽模式時反過來，確保中文頁上沒有）
    for rel in pages + removed:   # 拿掉日英頁的中文頁，也要把切換列收掉
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            continue
        s = open(p, encoding='utf-8').read()
        n = strip_i18n(s) if PREVIEW else inject(s, rel, 'zh-Hant')
        if n != s:
            changed += 1
            if mode != 'check':
                open(p, 'w', encoding='utf-8').write(n)
                touched.append(rel)
    if mode == 'check':
        print('日英版需要更新的檔案：%d' % changed)
        return 1 if changed else 0
    if not PREVIEW and update_sitemap(pages):
        touched.append('sitemap.xml')
    touched += ['scripts/i18n_tm/ja.json', 'scripts/i18n_tm/en.json']
    # ship.sh 只 commit 這份清單上的檔案，別人還沒 commit 的改動不會被一起帶走。
    # 列「這支管的所有檔案」而不只這一次改到的：上一次產了沒 commit 的，下一次也要帶上（11/3 第二批漏 commit 過中文頁）
    managed = set(touched) | set(pages) | {'sitemap.xml'}
    for l in LANGS:
        managed |= {os.path.join(l, r) for r in pages if os.path.exists(os.path.join(ROOT, l, r))}
    open(os.path.join(TMDIR, 'last_changed.txt'), 'w', encoding='utf-8').write('\n'.join(sorted(managed)) + '\n')
    print('✅ 日英版已產生（%d 頁 × 2 語言），這次有變動 %d 個檔案' % (len(pages), changed))
    return 0


if __name__ == '__main__':
    a = sys.argv[1:]
    if a[:1] == ['--dump']:
        sys.exit(run('dump', a[1]))
    if a[:1] == ['--load']:
        tm = load_tm()
        d = json.load(open(a[1], encoding='utf-8'))
        for l in LANGS:
            for zh, t in d.get(l, {}).items():
                tm[l][key(zh)] = t
        save_tm(tm)
        print('已併入對照本：' + '、'.join('%s %d 段' % (l, len(d.get(l, {}))) for l in LANGS))
        sys.exit(0)
    if a[:1] == ['--auto']:
        sys.exit(run('auto'))
    if a[:1] == ['--check']:
        sys.exit(run('check'))
    sys.exit(run('build'))
